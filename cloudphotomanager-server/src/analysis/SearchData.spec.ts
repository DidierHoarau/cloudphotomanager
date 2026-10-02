import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import {
  DUPLICATES_MAX_GROUPS,
  DUPLICATES_MAX_ROWS,
  SEARCH_MAX_RESULTS,
  SearchDataListAccountDuplicates,
  SearchDataListFiles,
} from "./SearchData";

describe("SearchData limits", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  interface FileRow {
    id: string;
    folderId: string;
    hash: string;
    dateMedia: string;
  }

  function insertFiles(accountId: string, rows: FileRow[]): void {
    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: any[] = [];
      for (const row of batch) {
        params.push(
          row.id,
          `cloud/${row.id}`,
          accountId,
          `${row.id}.jpg`,
          row.folderId,
          row.hash,
          row.dateMedia,
          row.dateMedia,
          row.dateMedia,
          "{}",
          "{}",
        );
      }
      SqlDbUtilsExecSQL(
        span,
        "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
          `VALUES ${placeholders}`,
        params,
      );
    }
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-search-spec-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("SearchData.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
  });

  it("caps search results and keeps a deterministic order", async () => {
    const accountId = "account-search-cap";
    const dateMedia = "2024-03-01T10:00:00.000Z";
    const rows: FileRow[] = [];
    for (let index = 0; index < SEARCH_MAX_RESULTS + 25; index++) {
      rows.push({
        id: `cap-${String(index).padStart(5, "0")}`,
        folderId: "folder-search-cap",
        hash: `hash-cap-${index}`,
        dateMedia,
      });
    }
    insertFiles(accountId, rows);

    const files = await SearchDataListFiles(span, accountId, {});
    expect(files).toHaveLength(SEARCH_MAX_RESULTS);
    expect(new Set(files.map((file) => file.id)).size).toBe(
      SEARCH_MAX_RESULTS,
    );
    // dateMedia identical for every row: the id tiebreaker decides.
    expect(files[0].id).toBe(
      `cap-${String(SEARCH_MAX_RESULTS + 24).padStart(5, "0")}`,
    );
  });

  it("filters search results to the permitted folders", async () => {
    const accountId = "account-search-filter";
    const dateMedia = "2024-03-01T10:00:00.000Z";
    insertFiles(accountId, [
      { id: "filter-a", folderId: "folder-p", hash: "h1", dateMedia },
      { id: "filter-b", folderId: "folder-p", hash: "h2", dateMedia },
      { id: "filter-c", folderId: "folder-q", hash: "h3", dateMedia },
    ]);

    const permitted = await SearchDataListFiles(span, accountId, {}, [
      "folder-p",
    ]);
    expect(permitted.map((file) => file.id).sort()).toEqual([
      "filter-a",
      "filter-b",
    ]);

    const unfiltered = await SearchDataListFiles(span, accountId, {}, null);
    expect(unfiltered).toHaveLength(3);

    const none = await SearchDataListFiles(span, accountId, {}, []);
    expect(none).toHaveLength(0);
  });

  it("caps duplicate groups while keeping rows complete per group", async () => {
    const accountId = "account-duplicates-groups";
    const dateMedia = "2024-03-01T10:00:00.000Z";
    const rows: FileRow[] = [];
    const groupCount = DUPLICATES_MAX_GROUPS + 20;
    for (let group = 0; group < groupCount; group++) {
      const hash = `group-hash-${String(group).padStart(4, "0")}`;
      for (let member = 0; member < 2; member++) {
        rows.push({
          id: `grp-${group}-${member}`,
          folderId: "folder-dups",
          hash,
          dateMedia,
        });
      }
    }
    // A unique-hash file must never show up as a duplicate.
    rows.push({
      id: "grp-unique",
      folderId: "folder-dups",
      hash: "unique-hash",
      dateMedia,
    });
    insertFiles(accountId, rows);

    const duplicates = await SearchDataListAccountDuplicates(
      span,
      accountId,
      null,
    );
    expect(duplicates).toHaveLength(DUPLICATES_MAX_GROUPS);
    const totalFiles = duplicates.reduce(
      (sum, duplicate) => sum + duplicate.files.length,
      0,
    );
    expect(totalFiles).toBe(DUPLICATES_MAX_GROUPS * 2);
    // Deterministic ordering by hash.
    expect(duplicates[0].hash).toBe("group-hash-0000");
    expect(duplicates[duplicates.length - 1].hash).toBe(
      `group-hash-${String(DUPLICATES_MAX_GROUPS - 1).padStart(4, "0")}`,
    );
    expect(
      duplicates.some((duplicate) => duplicate.hash === "unique-hash"),
    ).toBe(false);
  });

  it("caps duplicate rows across groups", async () => {
    const accountId = "account-duplicates-rows";
    const dateMedia = "2024-03-01T10:00:00.000Z";
    const rows: FileRow[] = [];
    const membersPerGroup = 21;
    // 500 groups x 21 = 10500 rows > DUPLICATES_MAX_ROWS (10000), while the
    // group count itself stays under the group cap.
    const groupCount = DUPLICATES_MAX_GROUPS;
    for (let group = 0; group < groupCount; group++) {
      const hash = `rows-hash-${String(group).padStart(4, "0")}`;
      for (let member = 0; member < membersPerGroup; member++) {
        rows.push({
          id: `dup-${String(group).padStart(4, "0")}-${String(member).padStart(2, "0")}`,
          folderId: "folder-dups-rows",
          hash,
          dateMedia,
        });
      }
    }
    insertFiles(accountId, rows);

    const duplicates = await SearchDataListAccountDuplicates(
      span,
      accountId,
      null,
    );
    const totalFiles = duplicates.reduce(
      (sum, duplicate) => sum + duplicate.files.length,
      0,
    );
    expect(duplicates.length).toBeLessThanOrEqual(DUPLICATES_MAX_GROUPS);
    expect(totalFiles).toBeLessThanOrEqual(DUPLICATES_MAX_ROWS);
    // The row cap is what kicks in here (groups fit under the group cap).
    expect(totalFiles).toBe(DUPLICATES_MAX_ROWS);
  }, 60000);

  it("restricts duplicates to the permitted folders", async () => {
    const accountId = "account-duplicates-filter";
    const dateMedia = "2024-03-01T10:00:00.000Z";
    insertFiles(accountId, [
      // Pair fully inside the permitted folder.
      { id: "df-a1", folderId: "folder-p", hash: "hash-a", dateMedia },
      { id: "df-a2", folderId: "folder-p", hash: "hash-a", dateMedia },
      // Pair split across permitted and non-permitted folders: only one
      // visible member, so it is not a duplicate for this user.
      { id: "df-b1", folderId: "folder-p", hash: "hash-b", dateMedia },
      { id: "df-b2", folderId: "folder-q", hash: "hash-b", dateMedia },
      // Pair fully outside the permitted folder.
      { id: "df-c1", folderId: "folder-q", hash: "hash-c", dateMedia },
      { id: "df-c2", folderId: "folder-q", hash: "hash-c", dateMedia },
    ]);

    const filtered = await SearchDataListAccountDuplicates(span, accountId, [
      "folder-p",
    ]);
    expect(filtered.map((duplicate) => duplicate.hash)).toEqual(["hash-a"]);
    expect(filtered[0].files.map((file) => file.id).sort()).toEqual([
      "df-a1",
      "df-a2",
    ]);

    const unfiltered = await SearchDataListAccountDuplicates(
      span,
      accountId,
      null,
    );
    expect(unfiltered.map((duplicate) => duplicate.hash).sort()).toEqual([
      "hash-a",
      "hash-b",
      "hash-c",
    ]);

    const none = await SearchDataListAccountDuplicates(span, accountId, []);
    expect(none).toEqual([]);
  });
});
