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
import type { Config } from "../Config";
import { File } from "../model/File";
import { Folder } from "../model/Folder";

// Wrap the query entry point so query counts can be asserted without
// changing behavior.
jest.mock("@devopsplaybook.io/common-utils", () => {
  const actual = jest.requireActual("@devopsplaybook.io/common-utils");
  return {
    ...actual,
    SqlDbUtilsQuerySQL: jest.fn(actual.SqlDbUtilsQuerySQL),
  };
});

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";

const queryMock = SqlDbUtilsQuerySQL as unknown as jest.Mock;

jest.setTimeout(60_000);

describe("Sync scale regression (10k files)", () => {
  let span: Span;
  let dataDir: string;
  let tmpDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let fileData: typeof import("../files/FileData");
  let folderData: typeof import("../folders/FolderData");
  let syncFileCache: typeof import("../sync/SyncFileCache");

  const accountId = "account-scale";
  const parentFolderpath = "/scale";
  let parentFolder: Folder;
  const directChildren: Folder[] = [];
  // scale-00000.jpg lands on the parent folder (index 0 of the folder cycle).
  let knownFileId: string;

  function queriesMatching(fragment: string): any[] {
    return queryMock.mock.calls.filter(
      (call: any[]) =>
        typeof call[1] === "string" && call[1].includes(fragment),
    );
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-scale-spec-"));
    dataDir = path.join(baseDir, "data");
    tmpDir = path.join(baseDir, "tmp");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("SyncScale.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(tmpDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    fileData = await import("../files/FileData");
    folderData = await import("../folders/FolderData");
    syncFileCache = await import("../sync/SyncFileCache");
    await fileData.FileDataInit(span, {
      DATA_DIR: dataDir,
      TMP_DIR: tmpDir,
    } as unknown as Config);
    await folderData.FolderDataInit(span);
    await syncFileCache.SyncFileCacheInit(span, {
      DATA_DIR: dataDir,
      TMP_DIR: tmpDir,
    } as unknown as Config);

    // No accounts row is seeded: every function under test works on rows and
    // directories only, and an empty accounts table keeps the folders-cache
    // flush from adding its own per-account count queries.

    parentFolder = new Folder(accountId, parentFolderpath);
    parentFolder.idCloud = "/cloud/scale";
    parentFolder.dateSync = new Date();
    parentFolder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, parentFolder);
    for (let index = 0; index < 10; index++) {
      const child = new Folder(accountId, `${parentFolderpath}/child-${index}`);
      child.idCloud = `/cloud/scale/child-${index}`;
      child.dateSync = new Date();
      child.dateUpdated = new Date();
      await folderData.FolderDataAdd(span, child);
      directChildren.push(child);
    }
    for (let index = 0; index < 5; index++) {
      const nested = new Folder(
        accountId,
        `${parentFolderpath}/child-0/nested-${index}`,
      );
      nested.idCloud = `/cloud/scale/child-0/nested-${index}`;
      nested.dateSync = new Date();
      nested.dateUpdated = new Date();
      await folderData.FolderDataAdd(span, nested);
    }
    await folderData.FolderDataCacheCountsFlush();

    // 10,000 files spread over the subtree, seeded with chunked multi-row
    // inserts (one FileDataAdd per file would dominate the runtime).
    const cycleFolders = [parentFolder, ...directChildren];
    const rows: string[][] = [];
    for (let index = 0; index < 10_000; index++) {
      const folder = cycleFolders[index % cycleFolders.length];
      const filename = `scale-${String(index).padStart(5, "0")}.jpg`;
      const file = new File(accountId, folder.id, filename);
      if (index === 0) {
        knownFileId = file.id;
      }
      rows.push([
        file.id,
        `cloud/scale/${index}`,
        accountId,
        filename,
        folder.id,
        `hash-${index}`,
        "2023-10-01T10:00:00.000Z",
        "2023-10-01T10:00:00.000Z",
        "2023-10-01T10:00:00.000Z",
        "{}",
        "{}",
      ]);
    }
    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const placeholders = batch
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      SqlDbUtilsExecSQL(
        span,
        "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
          `VALUES ${placeholders}`,
        batch.flat(),
      );
    }
  });

  it("FolderDataListSubFolders returns direct children with one query", async () => {
    queryMock.mockClear();
    const subFolders = await folderData.FolderDataListSubFolders(
      span,
      parentFolder,
    );

    expect(subFolders).toHaveLength(10);
    expect(subFolders.map((folder) => folder.id).sort()).toEqual(
      directChildren.map((folder) => folder.id).sort(),
    );
    // Exactly one query: the indexed direct-children range scan.
    expect(queryMock.mock.calls).toHaveLength(1);
  });

  it("SyncFileCacheCleanUp removes only orphans with one query", async () => {
    const cacheRoot = path.join(dataDir, "cache", accountId);
    const knownCacheDir = path.join(
      cacheRoot,
      knownFileId[0],
      knownFileId[1],
      knownFileId,
    );
    await fs.ensureDir(knownCacheDir);
    await fs.writeFile(path.join(knownCacheDir, "thumbnail.webp"), "known");
    const orphanId = "zzorphanfile000";
    const orphanDir = path.join(cacheRoot, orphanId[0], orphanId[1], orphanId);
    await fs.ensureDir(orphanDir);
    await fs.writeFile(path.join(orphanDir, "thumbnail.webp"), "orphan");

    queryMock.mockClear();
    await syncFileCache.SyncFileCacheCleanUp(span, {
      getAccountDefinition: () => ({ id: accountId }),
    } as any);

    expect(fs.existsSync(orphanDir)).toBe(false);
    expect(fs.existsSync(knownCacheDir)).toBe(true);
    // One id-set query; the old implementation loaded every File object.
    expect(queryMock.mock.calls).toHaveLength(1);
    expect(queryMock.mock.calls[0][1]).toContain(
      "SELECT id FROM files WHERE accountId = ?",
    );
  });

  it("1000 FileDataAdd calls run no counts aggregation until the flush", async () => {
    // Freeze timers: the 5s debounce maxWait must not fire mid-loop — the
    // point is to prove FileDataAdd itself never aggregates counts.
    jest.useFakeTimers();
    try {
      queryMock.mockClear();
      for (let index = 0; index < 1000; index++) {
        const file = new File(
          accountId,
          directChildren[index % directChildren.length].id,
          `added-${String(index).padStart(4, "0")}.jpg`,
        );
        file.idCloud = `cloud/added/${index}`;
        file.dateSync = new Date();
        file.dateUpdated = new Date();
        file.dateMedia = new Date();
        await fileData.FileDataAdd(span, file);
      }

      // No per-file aggregation on the hot path (M7).
      expect(queriesMatching("GROUP BY folderId")).toHaveLength(0);

      await folderData.FolderDataCacheCountsFlush();
    } finally {
      jest.useRealTimers();
    }
    const groupBys = queriesMatching("GROUP BY folderId");
    expect(groupBys).toHaveLength(1);
    expect(groupBys[0][2][0]).toBe(accountId);

    const counts = await folderData.FolderDataListCountsForAccount(
      span,
      accountId,
      true,
    );
    const totalCount = counts.reduce(
      (sum: number, entry: any) => sum + Number(entry.counts),
      0,
    );
    expect(totalCount).toBe(11_000);
  });
});
