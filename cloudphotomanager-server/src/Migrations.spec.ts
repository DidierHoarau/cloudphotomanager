import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsGetDatabase,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";

// The real migration directory shipped with the server.
const realSqlDir = path.resolve(__dirname, "../sql");

const NEW_INDEXES = [
  "files_accountId_hash",
  "folders_accountId_folderpath",
  "files_accountId_folderId",
];

function dbVersion(): number | null {
  const rows = SqlDbUtilsQuerySQL(
    undefined,
    "SELECT MAX(CAST(value AS INTEGER)) as maxVersion FROM metadata WHERE type='db_version'",
  );
  if (rows.length === 0 || rows[0].maxVersion === null) {
    return null;
  }
  return Number(rows[0].maxVersion);
}

function existingIndexes(): string[] {
  return SqlDbUtilsQuerySQL(
    undefined,
    `SELECT name FROM sqlite_master WHERE type='index' AND name IN (${NEW_INDEXES.map(() => "?").join(", ")})`,
    NEW_INDEXES,
  ).map((row) => row.name);
}

function closeCurrentDb(): void {
  const db = SqlDbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

describe("SQL migrations", () => {
  let tracer: StandardTracer;
  let span: Span;
  let baseDir: string;
  let dataDir: string;
  let sqlDir: string;

  beforeEach(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-migrations-spec-"));
    dataDir = path.join(baseDir, "data");
    sqlDir = path.join(baseDir, "sql");
    await fs.ensureDir(dataDir);
    await fs.ensureDir(sqlDir);
    tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = tracer.startSpan("Migrations.spec");
  });

  afterEach(async () => {
    closeCurrentDb();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("migrates a pre-init-0007 database at boot and stays idempotent", async () => {
    // Simulate the existing production DB: every migration except 0007.
    const files = (await fs.readdir(realSqlDir))
      .filter((name) => /^init-\d+\.sql$/.test(name) && name < "init-0007.sql")
      .sort();
    for (const name of files) {
      await fs.copy(path.join(realSqlDir, name), path.join(sqlDir, name));
    }
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(6);
    expect(existingIndexes()).toEqual([]);

    // Boot with init-0007.sql present: the three indexes are created once.
    await fs.copy(
      path.join(realSqlDir, "init-0007.sql"),
      path.join(sqlDir, "init-0007.sql"),
    );
    closeCurrentDb();
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(7);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());

    // A third boot re-applies nothing (idempotent re-run).
    const appliedLogBefore = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT COUNT(*) as count FROM metadata WHERE type='db_version'",
    );
    closeCurrentDb();
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(7);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());
    const appliedLogAfter = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT COUNT(*) as count FROM metadata WHERE type='db_version'",
    );
    expect(appliedLogAfter[0].count).toBe(appliedLogBefore[0].count);
  });

  it("creates the init-0007 indexes on a fresh install", async () => {
    const files = (await fs.readdir(realSqlDir)).filter((name) =>
      /^init-\d+\.sql$/.test(name),
    );
    for (const name of files.sort()) {
      await fs.copy(path.join(realSqlDir, name), path.join(sqlDir, name));
    }
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(7);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());
  });
});
