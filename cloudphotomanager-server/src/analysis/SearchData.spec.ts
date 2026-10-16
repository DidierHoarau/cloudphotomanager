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
  SEARCH_LABELS_MAX,
  SEARCH_MAX_RESULTS,
  SearchDataAggregateByGeoGrid,
  SearchDataListAccountDuplicates,
  SearchDataListAccountLabels,
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
    filename?: string;
    keywords?: string;
  }

  function insertFiles(accountId: string, rows: FileRow[]): void {
    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const placeholders = batch
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      const params: any[] = [];
      for (const row of batch) {
        params.push(
          row.id,
          `cloud/${row.id}`,
          accountId,
          row.filename ?? `${row.id}.jpg`,
          row.folderId,
          row.hash,
          row.dateMedia,
          row.dateMedia,
          row.dateMedia,
          "{}",
          "{}",
          row.keywords ?? null,
        );
      }
      SqlDbUtilsExecSQL(
        span,
        "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata, keywords) " +
          `VALUES ${placeholders}`,
        params,
      );
    }
  }

  function insertFolders(
    accountId: string,
    rows: { id: string; folderpath: string }[],
  ): void {
    for (const row of rows) {
      SqlDbUtilsExecSQL(
        span,
        "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          row.id,
          `cloud/${row.folderpath}`,
          accountId,
          row.folderpath,
          new Date().toISOString(),
          new Date().toISOString(),
          "{}",
        ],
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

  it("excludes trashed files and supports favoriteOnly across search, duplicates and the geo grid", async () => {
    const accountId = "account-curation-filter";
    const dateMedia = "2024-04-01T10:00:00.000Z";
    insertFiles(accountId, [
      { id: "cur-fav", folderId: "folder-p", hash: "hash-fav", dateMedia },
      { id: "cur-plain", folderId: "folder-p", hash: "hash-plain", dateMedia },
      { id: "cur-keep1", folderId: "folder-p", hash: "hash-keep", dateMedia },
      { id: "cur-keep2", folderId: "folder-p", hash: "hash-keep", dateMedia },
      // One member of this pair is trashed: the survivor alone must not
      // surface as a duplicate group.
      { id: "cur-trash", folderId: "folder-p", hash: "hash-dup", dateMedia },
      { id: "cur-survivor", folderId: "folder-p", hash: "hash-dup", dateMedia },
      // A fully trashed pair disappears entirely.
      { id: "cur-gone1", folderId: "folder-p", hash: "hash-gone", dateMedia },
      { id: "cur-gone2", folderId: "folder-p", hash: "hash-gone", dateMedia },
    ]);
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET favorite = 1 WHERE id = 'cur-fav'",
    );
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET trashed = 1, dateTrashed = ? WHERE id IN ('cur-trash', 'cur-gone1', 'cur-gone2')",
      [new Date().toISOString()],
    );
    // GPS info: cur-fav stays visible, cur-trash is trashed and must drop
    // out of the geo grid aggregation.
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET info = ? WHERE id = 'cur-fav'",
      [
        JSON.stringify({
          exif: { GPSInfo: { GPSLatitudeDecimal: 1.5, GPSLongitudeDecimal: 2.5 } },
        }),
      ],
    );
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET info = ? WHERE id = 'cur-trash'",
      [
        JSON.stringify({
          exif: { GPSInfo: { GPSLatitudeDecimal: 5.5, GPSLongitudeDecimal: 6.5 } },
        }),
      ],
    );

    const search = await SearchDataListFiles(span, accountId, {});
    expect(search.map((file) => file.id).sort()).toEqual([
      "cur-fav",
      "cur-keep1",
      "cur-keep2",
      "cur-plain",
      "cur-survivor",
    ]);
    expect(search.find((file) => file.id === "cur-fav").favorite).toBe(1);

    const favorites = await SearchDataListFiles(span, accountId, {
      favoriteOnly: true,
    });
    expect(favorites.map((file) => file.id)).toEqual(["cur-fav"]);

    const duplicates = await SearchDataListAccountDuplicates(
      span,
      accountId,
      null,
    );
    expect(duplicates.map((duplicate) => duplicate.hash)).toEqual([
      "hash-keep",
    ]);

    const grid = await SearchDataAggregateByGeoGrid(span, accountId, {
      bbox: { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 },
      gridRows: 10,
      gridCols: 10,
    });
    expect(grid.cells).toHaveLength(1);
    expect(grid.cells[0].count).toBe(1);
    expect(grid.cells[0].centerLat).toBeCloseTo(1.5);
    expect(grid.cells[0].centerLon).toBeCloseTo(2.5);
  });

  it("filters search results by media type, ignoring unknown values", async () => {
    const accountId = "account-search-mediatype";
    const dateMedia = "2024-05-01T10:00:00.000Z";
    insertFiles(accountId, [
      { id: "mt-jpg", folderId: "folder-mt", hash: "h1", dateMedia, filename: "photo.jpg" },
      { id: "mt-png", folderId: "folder-mt", hash: "h2", dateMedia, filename: "drawing.PNG" },
      { id: "mt-mp4", folderId: "folder-mt", hash: "h3", dateMedia, filename: "clip.mp4" },
      { id: "mt-dng", folderId: "folder-mt", hash: "h4", dateMedia, filename: "shot.dng" },
      { id: "mt-txt", folderId: "folder-mt", hash: "h5", dateMedia, filename: "notes.txt" },
    ]);

    const images = await SearchDataListFiles(span, accountId, {
      mediaTypes: ["image"],
    });
    expect(images.map((file) => file.id).sort()).toEqual([
      "mt-jpg",
      "mt-png",
    ]);

    const videos = await SearchDataListFiles(span, accountId, {
      mediaTypes: ["video"],
    });
    expect(videos.map((file) => file.id)).toEqual(["mt-mp4"]);

    const raw = await SearchDataListFiles(span, accountId, {
      mediaTypes: ["imageRaw"],
    });
    expect(raw.map((file) => file.id)).toEqual(["mt-dng"]);

    const combined = await SearchDataListFiles(span, accountId, {
      mediaTypes: ["video", "imageRaw"],
    });
    expect(combined.map((file) => file.id).sort()).toEqual([
      "mt-dng",
      "mt-mp4",
    ]);

    // Unknown values are ignored: no extension matched means no results for
    // this selection rather than an error or an unfiltered listing.
    const invalid = await SearchDataListFiles(span, accountId, {
      mediaTypes: ["document", "audio"],
    });
    expect(invalid).toHaveLength(0);
  });

  it("filters search results by folder subtree, permission and existence", async () => {
    const accountId = "account-search-folderfacet";
    const dateMedia = "2024-05-02T10:00:00.000Z";
    insertFolders(accountId, [
      { id: "folder-root", folderpath: "/root" },
      { id: "folder-child", folderpath: "/root/child" },
      { id: "folder-other", folderpath: "/other" },
    ]);
    insertFiles(accountId, [
      { id: "ff-root", folderId: "folder-root", hash: "h1", dateMedia },
      { id: "ff-child", folderId: "folder-child", hash: "h2", dateMedia },
      { id: "ff-other", folderId: "folder-other", hash: "h3", dateMedia },
    ]);

    const subtree = await SearchDataListFiles(span, accountId, {
      folderId: "folder-root",
    });
    expect(subtree.map((file) => file.id).sort()).toEqual([
      "ff-child",
      "ff-root",
    ]);

    const single = await SearchDataListFiles(span, accountId, {
      folderId: "folder-child",
    });
    expect(single.map((file) => file.id)).toEqual(["ff-child"]);

    // A folder outside the permitted list returns no results.
    const restricted = await SearchDataListFiles(
      span,
      accountId,
      { folderId: "folder-other" },
      ["folder-root", "folder-child"],
    );
    expect(restricted).toHaveLength(0);

    const permitted = await SearchDataListFiles(
      span,
      accountId,
      { folderId: "folder-child" },
      ["folder-root", "folder-child"],
    );
    expect(permitted.map((file) => file.id)).toEqual(["ff-child"]);

    // An unknown folder id returns no results.
    const unknown = await SearchDataListFiles(span, accountId, {
      folderId: "folder-does-not-exist",
    });
    expect(unknown).toHaveLength(0);
  });

  it("filters search results by hasLocation and outtakesOnly", async () => {
    const accountId = "account-search-location";
    const dateMedia = "2024-05-03T10:00:00.000Z";
    insertFiles(accountId, [
      { id: "loc-gps", folderId: "folder-loc", hash: "h1", dateMedia },
      { id: "loc-nogps", folderId: "folder-loc", hash: "h2", dateMedia },
      { id: "loc-outtake", folderId: "folder-loc", hash: "h3", dateMedia, filename: "pic-outtake.jpg" },
      { id: "loc-keep", folderId: "folder-loc", hash: "h4", dateMedia, filename: "pic.jpg" },
    ]);
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET info = ? WHERE id = 'loc-gps'",
      [
        JSON.stringify({
          exif: { GPSInfo: { GPSLatitudeDecimal: 10.5, GPSLongitudeDecimal: -20.5 } },
        }),
      ],
    );

    const located = await SearchDataListFiles(span, accountId, {
      hasLocation: true,
    });
    expect(located.map((file) => file.id)).toEqual(["loc-gps"]);

    const outtakes = await SearchDataListFiles(span, accountId, {
      outtakesOnly: true,
    });
    expect(outtakes.map((file) => file.id)).toEqual(["loc-outtake"]);

    const combined = await SearchDataListFiles(span, accountId, {
      hasLocation: true,
      outtakesOnly: true,
    });
    expect(combined).toHaveLength(0);
  });

  it("lists account labels with counts, ordering and scoping", async () => {
    const accountId = "account-search-labels";
    const dateMedia = "2024-05-04T10:00:00.000Z";
    insertFolders(accountId, [
      { id: "labels-p", folderpath: "/labels-p" },
      { id: "labels-q", folderpath: "/labels-q" },
    ]);
    insertFiles(accountId, [
      {
        id: "lab-1",
        folderId: "labels-p",
        hash: "h1",
        dateMedia,
        filename: "beach1.jpg",
        keywords: "beach1.jpg sand beach summer",
      },
      {
        id: "lab-2",
        folderId: "labels-p",
        hash: "h2",
        dateMedia,
        filename: "beach2.jpg",
        keywords: "beach2.jpg beach sand",
      },
      {
        id: "lab-3",
        folderId: "labels-q",
        hash: "h3",
        dateMedia,
        filename: "mountain.jpg",
        keywords: "mountain.jpg mountain beach",
      },
      {
        id: "lab-4",
        folderId: "labels-p",
        hash: "h4",
        dateMedia,
        filename: "numbers.jpg",
        keywords: "numbers.jpg 2024 42 dog",
      },
      // Trashed files must not contribute labels.
      {
        id: "lab-5",
        folderId: "labels-p",
        hash: "h5",
        dateMedia,
        filename: "gone.jpg",
        keywords: "gone.jpg beach",
      },
    ]);
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET trashed = 1, dateTrashed = ? WHERE id = 'lab-5'",
      [new Date().toISOString()],
    );

    const labels = await SearchDataListAccountLabels(span, accountId, null);
    expect(labels).toEqual([
      { label: "beach", count: 3 },
      { label: "sand", count: 2 },
      { label: "dog", count: 1 },
      { label: "mountain", count: 1 },
      { label: "summer", count: 1 },
    ]);

    // Folder permission scoping.
    const scoped = await SearchDataListAccountLabels(span, accountId, [
      "labels-q",
    ]);
    expect(scoped).toEqual([
      { label: "beach", count: 1 },
      { label: "mountain", count: 1 },
    ]);

    const none = await SearchDataListAccountLabels(span, accountId, []);
    expect(none).toEqual([]);
  });

  it("caps the label list to SEARCH_LABELS_MAX sorted by count then label", async () => {
    const accountId = "account-search-labels-cap";
    const dateMedia = "2024-05-05T10:00:00.000Z";
    const rows: FileRow[] = [];
    for (let index = 0; index < SEARCH_LABELS_MAX + 10; index++) {
      rows.push({
        id: `caplab-${String(index).padStart(4, "0")}`,
        folderId: "labels-cap",
        hash: `hcap-${index}`,
        dateMedia,
        filename: `file${index}.jpg`,
        keywords: `file${index}.jpg label${String(index).padStart(4, "0")}`,
      });
    }
    insertFiles(accountId, rows);

    const labels = await SearchDataListAccountLabels(span, accountId, null);
    expect(labels).toHaveLength(SEARCH_LABELS_MAX);
    // All counts equal: the alphabetical tiebreaker decides.
    expect(labels[0].label).toBe("label0000");
    expect(labels[labels.length - 1].label).toBe("label0199");
  });
});
