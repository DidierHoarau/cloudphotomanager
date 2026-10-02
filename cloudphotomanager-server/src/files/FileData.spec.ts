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

  // Pagination determinism (D6): files sharing the same dateMedia must not
  // repeat or disappear across pages; every page reports the full total.

  function insertFileRow(
    accountId: string,
    folderId: string,
    fileId: string,
    dateMediaIso: string,
  ): void {
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        fileId,
        `cloud/${fileId}`,
        accountId,
        `${fileId}.jpg`,
        folderId,
        `hash-${fileId}`,
        dateMediaIso,
        dateMediaIso,
        dateMediaIso,
        "{}",
        "{}",
      ],
    );
  }

  async function collectAllPages(
    fetchPage: (page: number) => Promise<{ files: File[]; total: number }>,
    pageSize: number,
    total: number,
  ): Promise<{ ids: string[]; totals: number[] }> {
    const ids: string[] = [];
    const totals: number[] = [];
    const pages = Math.ceil(total / pageSize);
    for (let page = 0; page < pages; page++) {
      const result = await fetchPage(page);
      totals.push(result.total);
      ids.push(...result.files.map((file) => file.id));
    }
    return { ids, totals };
  }

  it("pages by folder without repeats or skips when dateMedia is identical", async () => {
    const accountId = "account-paging-folder";
    const folderId = "folder-paging";
    const sameDate = new Date("2023-06-01T12:00:00.000Z").toISOString();
    const expectedIds = [];
    for (let index = 0; index < 25; index++) {
      const fileId = `file-${String(index).padStart(2, "0")}`;
      insertFileRow(accountId, folderId, fileId, sameDate);
      expectedIds.push(fileId);
    }

    const { ids, totals } = await collectAllPages(
      (page) =>
        fileData.FileDataListByFolderPaginated(
          span,
          accountId,
          folderId,
          "desc",
          page,
          10,
        ),
      10,
      25,
    );

    expect(totals).toEqual([25, 25, 25]);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect([...ids].sort()).toEqual([...expectedIds].sort());
    // Deterministic tiebreaker: id DESC inside equal dateMedia.
    expect(ids.slice(0, 10)).toEqual([
      "file-24",
      "file-23",
      "file-22",
      "file-21",
      "file-20",
      "file-19",
      "file-18",
      "file-17",
      "file-16",
      "file-15",
    ]);
  });

  it("pages recursively without repeats or skips when dateMedia is identical", async () => {
    const accountId = "account-paging-recursive";
    const sameDate = new Date("2023-06-01T12:00:00.000Z").toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "folder-rec-root",
        "cloud/root",
        accountId,
        "/series",
        sameDate,
        sameDate,
        "{}",
      ],
    );
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "folder-rec-child",
        "cloud/child",
        accountId,
        "/series/child",
        sameDate,
        sameDate,
        "{}",
      ],
    );
    const expectedIds = [];
    for (let index = 0; index < 12; index++) {
      const fileId = `rec-${String(index).padStart(2, "0")}`;
      const folderId = index % 2 === 0 ? "folder-rec-root" : "folder-rec-child";
      insertFileRow(accountId, folderId, fileId, sameDate);
      expectedIds.push(fileId);
    }

    const { ids, totals } = await collectAllPages(
      (page) =>
        fileData.FileDataListByFolderRecursivePaginated(
          span,
          accountId,
          "/series",
          "asc",
          page,
          5,
        ),
      5,
      12,
    );

    expect(totals).toEqual([12, 12, 12]);
    expect(new Set(ids).size).toBe(12);
    expect([...ids].sort()).toEqual([...expectedIds].sort());
    // Deterministic tiebreaker: id ASC inside equal dateMedia.
    expect(ids.slice(0, 3)).toEqual(["rec-00", "rec-01", "rec-02"]);
  });

  it("pages an account by dateMedia with a deterministic tiebreaker", async () => {
    const accountId = "account-paging-account";
    const folderId = "folder-paging-account";
    const newer = new Date("2024-01-01T00:00:00.000Z").toISOString();
    const older = new Date("2020-01-01T00:00:00.000Z").toISOString();
    const sameNewer = [];
    for (let index = 0; index < 6; index++) {
      const fileId = `acc-same-${index}`;
      insertFileRow(accountId, folderId, fileId, newer);
      sameNewer.push(fileId);
    }
    const olderIds = ["acc-old-a", "acc-old-b"];
    for (const fileId of olderIds) {
      insertFileRow(accountId, folderId, fileId, older);
    }

    const { ids, totals } = await collectAllPages(
      (page) =>
        fileData.FileDataListForAccountPaginated(span, accountId, page, 4),
      4,
      8,
    );

    expect(totals).toEqual([8, 8]);
    expect(new Set(ids).size).toBe(8);
    // All newer files come first, ordered by id DESC among the ties.
    expect(ids.slice(0, 6)).toEqual([...sameNewer].sort().reverse());
    expect(ids.slice(6).sort()).toEqual([...olderIds].sort());
  });
});
