import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import { File } from "../model/File";

// Wrap SqlDbUtilsQuerySQL in a jest.fn so the query counts can be asserted
// without changing behavior.
jest.mock("@devopsplaybook.io/common-utils", () => {
  const actual = jest.requireActual("@devopsplaybook.io/common-utils");
  return {
    ...actual,
    SqlDbUtilsQuerySQL: jest.fn(actual.SqlDbUtilsQuerySQL),
  };
});

import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";

const queryMock = SqlDbUtilsQuerySQL as unknown as jest.Mock;

describe("FolderData counts cache (M7)", () => {
  let span: Span;
  let dataDir: string;
  let tmpDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let fileData: typeof import("../files/FileData");
  let folderData: typeof import("../folders/FolderData");

  const accountId = "account-counts-hotpath";

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-counts-spec-"));
    dataDir = path.join(baseDir, "data");
    tmpDir = path.join(baseDir, "tmp");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("FileDataCountsCache.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(tmpDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    fileData = await import("../files/FileData");
    folderData = await import("../folders/FolderData");
    await fileData.FileDataInit(span, {
      DATA_DIR: dataDir,
      TMP_DIR: tmpDir,
    } as unknown as Config);
    await folderData.FolderDataInit(span);

    const date = new Date("2023-09-01T12:00:00.000Z").toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "folder-counts-hotpath",
        "cloud/hotpath",
        accountId,
        "/hotpath",
        date,
        date,
        "{}",
      ],
    );
  });

  function groupByCallsFor(targetAccountId: string): any[] {
    return queryMock.mock.calls.filter(
      (call: any[]) =>
        typeof call[1] === "string" &&
        call[1].includes("GROUP BY folderId") &&
        call[2] &&
        call[2][0] === targetAccountId,
    );
  }

  it("file mutations do not aggregate counts per file; the debounced flush does it once", async () => {
    queryMock.mockClear();
    for (let index = 0; index < 50; index++) {
      const file = new File(accountId, "folder-counts-hotpath", `hot-${index}.jpg`);
      file.idCloud = `cloud/hot-${index}`;
      file.dateSync = new Date();
      file.dateUpdated = new Date();
      file.dateMedia = new Date();
      file.info = {};
      file.metadata = {};
      await fileData.FileDataAdd(span, file);
    }

    // No aggregation awaited on the hot path.
    expect(groupByCallsFor(accountId)).toHaveLength(0);

    // Flushing the debounced refresh aggregates the dirty account once.
    await folderData.FolderDataCacheCountsFlush();
    expect(groupByCallsFor(accountId)).toHaveLength(1);

    const counts = await folderData.FolderDataListCountsForAccount(
      span,
      accountId,
      true,
    );
    expect(counts).toHaveLength(1);
    expect(counts[0].folderId).toBe("folder-counts-hotpath");
    expect(Number((counts[0] as any).counts)).toBe(50);
  });

  it("keyword updates trigger no cache work at all", async () => {
    queryMock.mockClear();
    const stored = await fileData.FileDataGet(
      span,
      new File(accountId, "folder-counts-hotpath", "hot-0.jpg").id,
    );
    const groupByBefore = groupByCallsFor(accountId).length;
    await fileData.FileDataUpdateKeywords(span, {
      ...stored,
      keywords: "tagged",
    } as File);
    expect(groupByCallsFor(accountId)).toHaveLength(groupByBefore);
  });
});
