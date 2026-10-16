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

  it("recursive listing returns the true total for an empty page past the end", async () => {
    const accountId = "account-paging-empty-page";
    const folderId = "folder-empty-page";
    const date = new Date("2023-07-01T12:00:00.000Z").toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [folderId, "cloud/empty-page", accountId, "/empty-page", date, date, "{}"],
    );
    for (let index = 0; index < 7; index++) {
      insertFileRow(accountId, folderId, `empty-page-${index}`, date);
    }

    // Page 0 is normal, page 1 holds the remaining file, page 5 (offset 15)
    // is past the end and must still report the true total.
    const first = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/empty-page",
      "asc",
      0,
      5,
    );
    expect(first.files).toHaveLength(5);
    expect(first.total).toBe(7);

    const lastPartial = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/empty-page",
      "asc",
      1,
      5,
    );
    expect(lastPartial.files).toHaveLength(2);
    expect(lastPartial.total).toBe(7);

    const pastEnd = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/empty-page",
      "asc",
      5,
      5,
    );
    expect(pastEnd.files).toEqual([]);
    expect(pastEnd.total).toBe(7);
  });

  it("recursive listing works for folder names containing LIKE wildcard characters", async () => {
    const accountId = "account-paging-wildcard";
    const folderId = "folder-wildcard";
    const childId = "folder-wildcard-child";
    const date = new Date("2023-08-01T12:00:00.000Z").toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [folderId, "cloud/wc", accountId, "/trip_2024.summer", date, date, "{}"],
    );
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        childId,
        "cloud/wc-child",
        accountId,
        "/trip_2024.summer/seq_01",
        date,
        date,
        "{}",
      ],
    );
    insertFileRow(accountId, folderId, "wc-root-1", date);
    insertFileRow(accountId, childId, "wc-child-1", date);
    insertFileRow(accountId, childId, "wc-child-2", date);

    const result = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/trip_2024.summer",
      "asc",
      0,
      10,
    );
    expect(result.total).toBe(3);
    expect(result.files.map((file) => file.id).sort()).toEqual([
      "wc-child-1",
      "wc-child-2",
      "wc-root-1",
    ]);
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

  // Favorites and trash (soft delete)

  function insertFileRowAt(
    accountId: string,
    folderId: string,
    fileId: string,
    dateMediaIso: string,
  ): void {
    insertFileRow(accountId, folderId, fileId, dateMediaIso);
  }

  it("round-trips favorite, trashed and dateTrashed through fromRaw", async () => {
    const accountId = "account-curation-rt";
    const folderId = "folder-curation-rt";
    const date = new Date("2023-03-01T12:00:00.000Z").toISOString();
    insertFileRowAt(accountId, folderId, "crt-plain", date);
    insertFileRowAt(accountId, folderId, "crt-fav", date);
    insertFileRowAt(accountId, folderId, "crt-trashed", date);

    await fileData.FileDataUpdateFavorite(span, "crt-fav", true);
    await fileData.FileDataTrash(span, "crt-trashed");

    const plain = await fileData.FileDataGet(span, "crt-plain");
    expect(plain.favorite).toBe(0);
    expect(plain.trashed).toBe(0);
    expect(plain.dateTrashed).toBeNull();

    const fav = await fileData.FileDataGet(span, "crt-fav");
    expect(fav.favorite).toBe(1);

    const trashed = await fileData.FileDataGet(span, "crt-trashed");
    expect(trashed.trashed).toBe(1);
    expect(trashed.dateTrashed).not.toBeNull();

    await fileData.FileDataUpdateFavorite(span, "crt-fav", false);
    const unfav = await fileData.FileDataGet(span, "crt-fav");
    expect(unfav.favorite).toBe(0);
  });

  it("trash and restore are conditional and idempotent", async () => {
    const accountId = "account-curation-idem";
    const folderId = "folder-curation-idem";
    const date = new Date("2023-03-02T12:00:00.000Z").toISOString();
    insertFileRowAt(accountId, folderId, "idem-a", date);

    // First trash affects the row; trashing again changes nothing.
    await expect(fileData.FileDataTrash(span, "idem-a")).resolves.toBe(1);
    const firstTrashDate = (await fileData.FileDataGet(span, "idem-a"))
      .dateTrashed;
    await expect(fileData.FileDataTrash(span, "idem-a")).resolves.toBe(0);
    expect(
      (await fileData.FileDataGet(span, "idem-a")).dateTrashed,
    ).toEqual(firstTrashDate);

    // Unknown file: no row affected.
    await expect(fileData.FileDataTrash(span, "idem-unknown")).resolves.toBe(0);

    // Restore returns the row; restoring again changes nothing.
    await expect(fileData.FileDataRestore(span, "idem-a")).resolves.toBe(1);
    const restored = await fileData.FileDataGet(span, "idem-a");
    expect(restored.trashed).toBe(0);
    expect(restored.dateTrashed).toBeNull();
    await expect(fileData.FileDataRestore(span, "idem-a")).resolves.toBe(0);
  });

  it("folder listings exclude trashed files and honor favoriteOnly", async () => {
    const accountId = "account-curation-lists";
    const folderId = "folder-curation-lists";
    const date = new Date("2023-04-01T12:00:00.000Z").toISOString();
    // The recursive listing matches on folder paths, so seed a folder row.
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [folderId, "cloud/lists", accountId, "/lists", date, date, "{}"],
    );
    insertFileRowAt(accountId, folderId, "cl-plain", date);
    insertFileRowAt(accountId, folderId, "cl-fav", date);
    insertFileRowAt(accountId, folderId, "cl-fav-trashed", date);
    insertFileRowAt(accountId, folderId, "cl-trashed", date);
    await fileData.FileDataUpdateFavorite(span, "cl-fav", true);
    await fileData.FileDataUpdateFavorite(span, "cl-fav-trashed", true);
    await fileData.FileDataTrash(span, "cl-trashed");
    await fileData.FileDataTrash(span, "cl-fav-trashed");

    const folderAll = await fileData.FileDataListByFolderPaginated(
      span,
      accountId,
      folderId,
      "asc",
      0,
      50,
    );
    expect(folderAll.total).toBe(2);
    expect(folderAll.files.map((f) => f.id).sort()).toEqual([
      "cl-fav",
      "cl-plain",
    ]);

    const folderFav = await fileData.FileDataListByFolderPaginated(
      span,
      accountId,
      folderId,
      "asc",
      0,
      50,
      true,
    );
    expect(folderFav.total).toBe(1);
    expect(folderFav.files.map((f) => f.id)).toEqual(["cl-fav"]);

    const folderRecAll = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/lists",
      "asc",
      0,
      50,
    );
    expect(folderRecAll.total).toBe(2);

    const folderRecFav = await fileData.FileDataListByFolderRecursivePaginated(
      span,
      accountId,
      "/lists",
      "asc",
      0,
      50,
      true,
    );
    expect(folderRecFav.total).toBe(1);
    expect(folderRecFav.files.map((f) => f.id)).toEqual(["cl-fav"]);

    // The nightly cache check listing skips trashed files account-wide.
    const accountPage = await fileData.FileDataListForAccountPaginated(
      span,
      accountId,
      0,
      50,
    );
    expect(accountPage.total).toBe(2);
    expect(accountPage.files.map((f) => f.id).sort()).toEqual([
      "cl-fav",
      "cl-plain",
    ]);
  });

  it("lists the trash paginated, newest first, and lists expired trash ids", async () => {
    const accountId = "account-curation-trash";
    const folderId = "folder-curation-trash";
    const date = new Date("2023-05-01T12:00:00.000Z").toISOString();
    insertFileRowAt(accountId, folderId, "tr-keep", date);
    for (let index = 0; index < 5; index++) {
      insertFileRowAt(accountId, folderId, `tr-${index}`, date);
      await fileData.FileDataTrash(span, `tr-${index}`);
    }

    const page0 = await fileData.FileDataListTrashPaginated(
      span,
      accountId,
      null,
      0,
      3,
    );
    expect(page0.total).toBe(5);
    expect(page0.files).toHaveLength(3);

    const page1 = await fileData.FileDataListTrashPaginated(
      span,
      accountId,
      null,
      1,
      3,
    );
    expect(page1.total).toBe(5);
    expect(page1.files).toHaveLength(2);

    const all = await fileData.FileDataListTrashPaginated(
      span,
      accountId,
      null,
      0,
      10,
    );
    expect(all.files.map((f) => f.id).sort()).toEqual([
      "tr-0",
      "tr-1",
      "tr-2",
      "tr-3",
      "tr-4",
    ]);

    // Expired-trash listing is account-wide, so pin the trash dates of this
    // test's files to a fixed old day and cut between that and the (current)
    // trash dates written by the other tests in this spec.
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET dateTrashed = ? WHERE id LIKE 'tr-_'",
      ["2020-01-01T00:00:00.000Z"],
    );

    // Not-yet-trashed files and future cutoffs return nothing.
    expect(
      (await fileData.FileDataListExpiredTrash(span, new Date(0).toISOString()))
        .length,
    ).toBe(0);
    const cutoff = new Date("2021-01-01T00:00:00.000Z").toISOString();
    const expired = await fileData.FileDataListExpiredTrash(span, cutoff);
    expect(expired.sort()).toEqual(["tr-0", "tr-1", "tr-2", "tr-3", "tr-4"]);

    // Restore removes a file from the trash listing.
    await fileData.FileDataRestore(span, "tr-0");
    const afterRestore = await fileData.FileDataListTrashPaginated(
      span,
      accountId,
      null,
      0,
      10,
    );
    expect(afterRestore.total).toBe(4);
  });

  it("summarizes months across folders and lists a month with UTC boundaries", async () => {
    const accountId = "account-curation-months";
    const folderA = "folder-months-a";
    const folderB = "folder-months-b";
    const marA = new Date("2022-03-15T10:00:00.000Z").toISOString();
    const marB = new Date("2022-03-31T23:59:59.999Z").toISOString();
    const apr = new Date("2022-04-01T00:00:00.000Z").toISOString();
    insertFileRowAt(accountId, folderA, "mo-a1", marA);
    insertFileRowAt(accountId, folderB, "mo-b1", marB);
    insertFileRowAt(accountId, folderA, "mo-a2", apr);
    await fileData.FileDataTrash(span, "mo-b1");

    const months = await fileData.FileDataListAccountMonths(
      span,
      accountId,
      null,
    );
    // Trashed files are excluded from the month summary.
    expect(months).toEqual([
      { year: 2022, month: 4, count: 1 },
      { year: 2022, month: 3, count: 1 },
    ]);

    // Month pagination uses UTC bounds: March 31 23:59:59.999Z is inside,
    // April 1 00:00:00.000Z is outside (and vice versa for the April month).
    const march = await fileData.FileDataListByMonthPaginated(
      span,
      accountId,
      null,
      "2022-03-01T00:00:00.000Z",
      "2022-04-01T00:00:00.000Z",
      "asc",
      0,
      50,
    );
    expect(march.total).toBe(1);
    expect(march.files.map((f) => f.id)).toEqual(["mo-a1"]);

    const april = await fileData.FileDataListByMonthPaginated(
      span,
      accountId,
      null,
      "2022-04-01T00:00:00.000Z",
      "2022-05-01T00:00:00.000Z",
      "desc",
      0,
      50,
    );
    expect(april.total).toBe(1);
    expect(april.files.map((f) => f.id)).toEqual(["mo-a2"]);

    // Restoring the trashed file brings it back into the month summary.
    await fileData.FileDataRestore(span, "mo-b1");
    const monthsAfter = await fileData.FileDataListAccountMonths(
      span,
      accountId,
      null,
    );
    expect(monthsAfter).toEqual([
      { year: 2022, month: 4, count: 1 },
      { year: 2022, month: 3, count: 2 },
    ]);
  });
});
