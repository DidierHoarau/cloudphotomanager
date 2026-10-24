import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { AccountDefinition } from "../model/AccountDefinition";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueItemStatus } from "../model/SyncQueueItemStatus";

describe("SyncQueue reliability", () => {
  const sqlDir = path.resolve(__dirname, "../../sql");
  let baseDir: string;
  let dataDir: string;
  let span: Span;
  let accountId: string;

  let syncQueue: typeof import("./SyncQueue");
  let accountData: typeof import("../accounts/AccountData");

  function queueRows(): any[] {
    return SqlDbUtilsQuerySQL(span, "SELECT * FROM sync_queue ORDER BY id");
  }

  async function waitUntil(
    description: string,
    check: () => boolean,
    timeoutMs = 15000,
  ): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for: ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function insertActiveRow(
    id: string,
    dateCreated: string,
    dateStarted: string | null,
  ): void {
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO sync_queue " +
        "(id, accountId, functionName, priority, status, data, fileIds, dateCreated, dateStarted) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        accountId,
        "testHang",
        SyncQueueItemPriority.BATCH,
        SyncQueueItemStatus.ACTIVE,
        "{}",
        "[]",
        dateCreated,
        dateStarted,
      ],
    );
  }

  beforeAll(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-syncqueue-spec-"));
    dataDir = path.join(baseDir, "data");
    process.env.DATA_DIR = dataDir;

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("SyncQueue.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    syncQueue = await import("./SyncQueue");
    accountData = await import("../accounts/AccountData");

    // Very short BATCH timeout so the test does not wait for the real 4h cap.
    await syncQueue.SyncQueueInit(span, {
      itemProcessTimeouts: { [SyncQueueItemPriority.BATCH]: 150 },
    });

    const account = new AccountDefinition();
    account.name = "queue-timeout-account";
    account.rootpath = baseDir;
    account.info = { type: "localDrive" };
    account.infoPrivate = {};
    await accountData.AccountDataAdd(span, account);
    accountId = account.id;
  });

  afterAll(async () => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("aborts a timed-out item, removes its row and frees the BATCH slot", async () => {
    let handlerSignal: AbortSignal | undefined;
    syncQueue.SyncQueueRegisterFunction(
      "testHang",
      (_account, _data, _priority, signal) => {
        handlerSignal = signal;
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted by timeout")),
            { once: true },
          );
        });
      },
    );

    syncQueue.SyncQueueQueueItem(
      accountId,
      "hang-item",
      {},
      "testHang",
      SyncQueueItemPriority.BATCH,
      ["file-hanging"],
    );

    await waitUntil("handler invoked", () => handlerSignal !== undefined);
    await waitUntil(
      "timed-out row removed",
      () => queueRows().every((row) => row.id !== "hang-item:testHang"),
    );

    expect(handlerSignal?.aborted).toBe(true);
    expect(syncQueue.SyncQueueGetProcessingFileIds()).not.toContain(
      "file-hanging",
    );

    // The BATCH pool has a single slot: the next item can only run once the
    // timed-out one released it.
    let quickRan = false;
    syncQueue.SyncQueueRegisterFunction("testQuick", async () => {
      quickRan = true;
    });
    syncQueue.SyncQueueQueueItem(
      accountId,
      "quick-item",
      {},
      "testQuick",
      SyncQueueItemPriority.BATCH,
    );

    await waitUntil("next BATCH item ran", () => quickRan);
    await waitUntil(
      "completed row removed",
      () => queueRows().every((row) => row.id !== "quick-item:testQuick"),
    );
  });

  it("sweeps stuck ACTIVE rows by start time, not enqueue time", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const now = new Date().toISOString();

    // Started long ago: orphaned, must be swept.
    insertActiveRow("stuck-old-start", twoHoursAgo, twoHoursAgo);
    // Waited a long time in the queue but started just now: still running.
    insertActiveRow("long-waiting-just-started", twoHoursAgo, now);
    // Legacy row without dateStarted: falls back to dateCreated.
    insertActiveRow("legacy-no-start", twoHoursAgo, null);

    const swept = syncQueue.SyncQueueSweepStuckActive();
    expect(swept).toBe(2);

    const remainingIds = queueRows().map((row) => row.id);
    expect(remainingIds).toContain("long-waiting-just-started");
    expect(remainingIds).not.toContain("stuck-old-start");
    expect(remainingIds).not.toContain("legacy-no-start");

    SqlDbUtilsExecSQL(span, "DELETE FROM sync_queue WHERE id = ?", [
      "long-waiting-just-started",
    ]);
    expect(queueRows()).toEqual([]);
  });
});
