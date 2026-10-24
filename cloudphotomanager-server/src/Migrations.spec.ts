import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";

// The real migration directory shipped with the server.
const realSqlDir = path.resolve(__dirname, "../sql");

const NEW_INDEXES = [
  "files_accountId_hash",
  "folders_accountId_folderpath_unique",
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
    // Simulate the existing production DB: every migration except 0007+.
    const files = (await fs.readdir(realSqlDir))
      .filter((name) => {
        const match = /^init-(\d+)\.sql$/.exec(name);
        return match !== null && Number(match[1]) < 7;
      })
      .sort();
    for (const name of files) {
      await fs.copy(path.join(realSqlDir, name), path.join(sqlDir, name));
    }
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(6);
    expect(existingIndexes()).toEqual([]);

    // Boot with init-0007.sql, init-0008.sql and init-0009.sql present: the
    // three indexes, the shares table and the favorite/trash columns are
    // created once.
    await fs.copy(
      path.join(realSqlDir, "init-0007.sql"),
      path.join(sqlDir, "init-0007.sql"),
    );
    await fs.copy(
      path.join(realSqlDir, "init-0008.sql"),
      path.join(sqlDir, "init-0008.sql"),
    );
    await fs.copy(
      path.join(realSqlDir, "init-0009.sql"),
      path.join(sqlDir, "init-0009.sql"),
    );
    await fs.copy(
      path.join(realSqlDir, "init-0010.sql"),
      path.join(sqlDir, "init-0010.sql"),
    );
    await fs.copy(
      path.join(realSqlDir, "init-0011.sql"),
      path.join(sqlDir, "init-0011.sql"),
    );
    await fs.copy(
      path.join(realSqlDir, "init-0012.sql"),
      path.join(sqlDir, "init-0012.sql"),
    );
    closeCurrentDb();
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(12);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());
    const trashColumns = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT name FROM pragma_table_info('files') WHERE name IN ('favorite', 'trashed', 'dateTrashed')",
    ).map((row) => row.name);
    expect(trashColumns.sort()).toEqual(["dateTrashed", "favorite", "trashed"]);
    const userColumns = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT name FROM pragma_table_info('users') WHERE name = 'tokenVersion'",
    ).map((row) => row.name);
    expect(userColumns).toEqual(["tokenVersion"]);
    const queueColumns = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT name FROM pragma_table_info('sync_queue') WHERE name = 'dateStarted'",
    ).map((row) => row.name);
    expect(queueColumns).toEqual(["dateStarted"]);

    // A third boot re-applies nothing (idempotent re-run).
    const appliedLogBefore = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT COUNT(*) as count FROM metadata WHERE type='db_version'",
    );
    closeCurrentDb();
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(12);
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
    expect(dbVersion()).toBe(12);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());
  });

  it("init-0012 dedupes duplicate folders, repoints references and adds the unique index", async () => {
    // Boot at 0011, then seed the legacy state init-0012 has to repair.
    const files = (await fs.readdir(realSqlDir))
      .filter((name) => {
        const match = /^init-(\d+)\.sql$/.exec(name);
        return match !== null && Number(match[1]) < 12;
      })
      .sort();
    for (const name of files) {
      await fs.copy(path.join(realSqlDir, name), path.join(sqlDir, name));
    }
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(11);

    const accountId = "account-dedupe";
    SqlDbUtilsExecSQL(
      undefined,
      "INSERT INTO accounts (id, name, rootpath, info, infoPrivate) VALUES (?, ?, ?, ?, ?)",
      [accountId, "Test", "/", "{}", "{}"],
    );
    // Two rows for the same (accountId, folderpath): the canonical one keeps
    // the lowest rowid (inserted first).
    const canonicalId = "folder-canonical";
    const duplicateId = "folder-duplicate";
    for (const [folderId, idCloud] of [
      [canonicalId, "/cloud/2023"],
      [duplicateId, "/cloud/2023-legacy"],
    ]) {
      SqlDbUtilsExecSQL(
        undefined,
        "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          folderId,
          idCloud,
          accountId,
          "/2023",
          new Date().toISOString(),
          new Date().toISOString(),
          "{}",
        ],
      );
    }
    // One file under each duplicate folder id, a share on the duplicate and a
    // permission grant on the duplicate: all must be repointed.
    for (const [fileId, folderId] of [
      ["file-canonical", canonicalId],
      ["file-duplicate", duplicateId],
    ]) {
      SqlDbUtilsExecSQL(
        undefined,
        "INSERT INTO files (id, idCloud, accountId, folderId, filename, dateSync, dateUpdated, dateMedia, hash, info, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          fileId,
          `/cloud/2023/${fileId}.jpg`,
          accountId,
          folderId,
          `${fileId}.jpg`,
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
          "hash",
          "{}",
          "{}",
        ],
      );
    }
    SqlDbUtilsExecSQL(
      undefined,
      "INSERT INTO shares (id, accountId, folderId, tokenHash, dateCreated, info) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "share-dedupe",
        accountId,
        duplicateId,
        "tokenhash",
        new Date().toISOString(),
        "{}",
      ],
    );
    SqlDbUtilsExecSQL(
      undefined,
      "INSERT INTO users_permissions (id, userId, info) VALUES (?, ?, ?)",
      [
        "perm-dedupe",
        "user-dedupe",
        JSON.stringify({
          isAdmin: false,
          folders: [
            { folderId: canonicalId, scope: "read" },
            { folderId: duplicateId, scope: "write" },
          ],
        }),
      ],
    );

    // Apply init-0012: duplicates are merged onto the canonical row.
    closeCurrentDb();
    await fs.copy(
      path.join(realSqlDir, "init-0012.sql"),
      path.join(sqlDir, "init-0012.sql"),
    );
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(12);
    expect(existingIndexes().sort()).toEqual([...NEW_INDEXES].sort());

    const folderRows = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT id FROM folders WHERE accountId = ?",
      [accountId],
    );
    expect(folderRows.map((row) => row.id)).toEqual([canonicalId]);
    const fileFolders = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT id, folderId FROM files WHERE accountId = ? ORDER BY id",
      [accountId],
    );
    expect(fileFolders).toEqual([
      { id: "file-canonical", folderId: canonicalId },
      { id: "file-duplicate", folderId: canonicalId },
    ]);
    const shareFolders = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT folderId FROM shares WHERE id = ?",
      ["share-dedupe"],
    );
    expect(shareFolders[0].folderId).toBe(canonicalId);
    const permRows = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT info FROM users_permissions WHERE id = ?",
      ["perm-dedupe"],
    );
    const permInfo = JSON.parse(permRows[0].info);
    expect(permInfo.folders).toEqual([
      { folderId: canonicalId, scope: "read" },
      { folderId: canonicalId, scope: "write" },
    ]);

    // Re-boot: the migration does not run again and nothing is lost.
    const folderCountBefore = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT COUNT(*) as count FROM folders",
    );
    closeCurrentDb();
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
    expect(dbVersion()).toBe(12);
    const folderCountAfter = SqlDbUtilsQuerySQL(
      undefined,
      "SELECT COUNT(*) as count FROM folders",
    );
    expect(folderCountAfter[0].count).toBe(folderCountBefore[0].count);
  });
});
