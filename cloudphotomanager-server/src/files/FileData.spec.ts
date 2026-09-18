import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { SqlDbUtilsInit, SqlDbUtilsSetOTel } from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import { File } from "../model/File";

describe("FileData", () => {
  let span: Span;
  let dataDir: string;
  let tmpDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let fileData: typeof import("./FileData");

  function makeFile(filename: string): File {
    const file = new File("account-1", "folder-1", filename);
    file.idCloud = "cloud-item-1";
    file.dateSync = new Date();
    file.dateUpdated = new Date();
    file.dateMedia = new Date();
    file.info = { size: 123 };
    file.metadata = {};
    return file;
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-filedata-spec-"));
    dataDir = path.join(baseDir, "data");
    tmpDir = path.join(baseDir, "tmp");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("FileData.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(tmpDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    fileData = await import("./FileData");
    await fileData.FileDataInit(span, {
      DATA_DIR: dataDir,
      TMP_DIR: tmpDir,
    } as unknown as Config);
  });

  it("update does not fail when hash is undefined and persists an empty hash", async () => {
    // Regression for "SqliteError: NOT NULL constraint failed: files.hash"
    // surfaced as [SyncQueue] Error Processing Queue Item: the folder
    // reconcile loop updates files whose cloud listing reports no hash
    // (Graph v1.0 stopped returning sha256Hash), and better-sqlite3 binds
    // undefined as NULL.
    const file = makeFile("no-hash.jpg");
    file.hash = "known-hash";
    await fileData.FileDataAdd(span, file);

    const toUpdate = await fileData.FileDataGet(span, file.id);
    toUpdate.hash = undefined as unknown as string;

    await expect(
      fileData.FileDataUpdate(span, toUpdate),
    ).resolves.toBeUndefined();

    const stored = await fileData.FileDataGet(span, file.id);
    expect(stored).not.toBeNull();
    expect(stored.hash).toBe("");
  });

  it("add persists an empty hash when hash is undefined", async () => {
    const file = makeFile("add-no-hash.jpg");
    file.hash = undefined as unknown as string;

    await fileData.FileDataAdd(span, file);

    const stored = await fileData.FileDataGet(span, file.id);
    expect(stored).not.toBeNull();
    expect(stored.hash).toBe("");
  });
});
