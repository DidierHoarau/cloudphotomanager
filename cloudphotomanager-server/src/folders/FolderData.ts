import { Span } from "@opentelemetry/sdk-trace-base";
import * as path from "path";
import { AccountDataList } from "../accounts/AccountData";
import { Folder } from "../model/Folder";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";
import debounce from "lodash/debounce";
import { OTelTracer } from "../OTelContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheAccountsFolders: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheAccountsFoldersCounts: any[] = [];

//
export async function FolderDataInit(context: Span) {
  const span = OTelTracer().startSpan("FolderData_init", context);
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataAdd(
  context: Span,
  folder: Folder
): Promise<void> {
  const span = OTelTracer().startSpan("FolderData_add", context);
  await SqlDbUtilsExecSQL(
    span,
    "DELETE FROM folders WHERE id = ? AND accountId = ?",
    [folder.id, folder.accountId]
  );
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO folders (id, idCloud, accountId, folderpath, dateUpdated, dateSync, info) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ",
    [
      folder.id,
      folder.idCloud,
      folder.accountId,
      folder.folderpath,
      folder.dateUpdated.toISOString(),
      folder.dateSync.toISOString(),
      JSON.stringify(folder.info),
    ]
  );
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataGet(
  context: Span,
  id: string
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGet", context);
  const folderRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE id = ?",
    [id]
  );
  if (folderRaw.length === 0) {
    return null;
  }
  return fromRaw(folderRaw[0]);
}

export async function FolderDataGetParent(
  context: Span,
  id: string
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGetParent", context);
  const folderChildRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE id = ?",
    [id]
  );
  if (folderChildRaw.length === 0) {
    return null;
  }
  const folderChild = fromRaw(folderChildRaw[0]);
  if (folderChild.folderpath === "/") {
    return null;
  }
  const folderParentRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? AND folderpath = ?",
    [folderChild.accountId, path.dirname(folderChild.folderpath)]
  );
  if (folderParentRaw.length === 0) {
    return null;
  }
  return fromRaw(folderParentRaw[0]);
}

export async function FolderDataUpdate(context: Span, folder: Folder) {
  const span = OTelTracer().startSpan("FolderDataUpdate", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE folders SET dateUpdated=?, dateSync=?, info=? WHERE id=? AND accountId=? ",
    [
      folder.dateUpdated.toISOString(),
      folder.dateSync.toISOString(),
      JSON.stringify(folder.info),
      folder.id,
      folder.accountId,
    ]
  );
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataGetByCloudId(
  context: Span,
  accountId: string,
  idCloud: string
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGetByCloudId", context);
  const folderRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? AND idCloud = ?",
    [accountId, idCloud]
  );
  if (folderRaw.length === 0) {
    return null;
  }
  return fromRaw(folderRaw[0]);
}

export async function FolderDataListSubFolders(
  context: Span,
  parentFolder: Folder
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataListSubFolders", context);
  const accountfolders = await FolderDataListForAccount(
    span,
    parentFolder.accountId
  );
  const folders = [];

  accountfolders.forEach((candidateFolder) => {
    if (
      path.relative(
        `${candidateFolder.folderpath}/`,
        parentFolder.folderpath
      ) === ".."
    ) {
      folders.push(fromRaw(candidateFolder));
    }
  });
  span.end();
  return folders;
}

export async function FolderDataListForAccount(
  context: Span,
  accountId: string,
  getCache = false
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataListForAccount", context);
  if (getCache) {
    span.addEvent("Cached");
    span.end();
    return cacheAccountsFolders[accountId];
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? ORDER BY folderpath ",
    [accountId]
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataListCountsForAccount(
  context: Span,
  accountId: string,
  getCache = false
): Promise<{ folderId: string; count: number }[]> {
  const span = OTelTracer().startSpan(
    "FolderDataListCountsForAccount",
    context
  );
  if (getCache) {
    span.addEvent("Cached");
    span.end();
    return cacheAccountsFoldersCounts[accountId];
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT count(*) as counts, folderId FROM files WHERE accountId = ? GROUP BY folderId ",
    [accountId]
  );
  const counts = [];
  rawData.forEach((folderRaw) => {
    counts.push({ folderId: folderRaw.folderId, counts: folderRaw.counts });
  });
  span.end();
  return counts;
}

export async function FolderDataDelete(
  context: Span,
  accountId: string,
  id: string
): Promise<void> {
  const span = OTelTracer().startSpan("FolderDataDelete", context);
  await SqlDbUtilsExecSQL(
    span,
    "DELETE FROM files WHERE accountId = ? AND id = ?",
    [accountId, id]
  );
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataGetOlderThan(
  context: Span,
  accountId: string,
  ageLimit: Date
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetOlderThan", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? AND dateSync < ? ",
    [accountId, ageLimit.toISOString()]
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataGetOldestSync(
  context: Span,
  accountId: string,
  limit: number
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetOldestSync", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? ORDER BY dateSync ASC LIMIT ? ",
    [accountId, limit]
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataGetNewestSync(
  context: Span,
  accountId: string,
  limit: number
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetNewestSync", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? ORDER BY dateSync DESC LIMIT ? ",
    [accountId, limit]
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataGetNewstUpdate(
  context: Span,
  accountId: string,
  limit: number
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetNewstUpdate", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? " +
      " AND id IN ( SELECT folderId FROM files WHERE accountId = ? ORDER BY dateUpdated DESC LIMIT ? ) ",
    [accountId, accountId, limit]
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataDeletePathRecursive(
  context: Span,
  accountId: string,
  folderpath: string
) {
  const span = OTelTracer().startSpan("FolderDataDeletePathRecursive", context);
  await SqlDbUtilsExecSQL(
    span,
    "DELETE FROM files " +
      " WHERE accountId = ? " +
      ` AND folderId IN ( SELECT id FROM folders WHERE accountId = ? AND folderpath LIKE ? ) `,
    [accountId, accountId, `${folderpath}%`]
  );
  await SqlDbUtilsExecSQL(
    span,
    `DELETE FROM folders WHERE accountId = ? AND folderpath LIKE ? `,
    [accountId, `${folderpath}%`]
  );
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataRefreshCacheFolders(
  context: Span
): Promise<void> {
  const span = OTelTracer().startSpan("FolderDataRefreshCacheFolders", context);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCache: any = {};
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = FolderDataListForAccount(span, account.id);
  }
  cacheAccountsFolders = newCache;
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FolderDataRefreshCacheFoldersCounts(
  context: Span
): Promise<void> {
  const span = OTelTracer().startSpan(
    "FolderDataRefreshCacheFoldersCounts",
    context
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCache: any = {};
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = FolderDataListCountsForAccount(span, account.id);
  }
  cacheAccountsFoldersCounts = newCache;
  span.end();
}

export async function FolderDataDeleteFoldersWithDuplicates(context: Span) {
  const span = OTelTracer().startSpan(
    "FolderDataDeleteFoldersWithDuplicates",
    context
  );
  SqlDbUtilsExecSQL(
    span,
    `
      DELETE FROM folders
      WHERE rowid IN (
        SELECT f1.rowid
        FROM folders f1
        JOIN (
          SELECT accountid, folderPath
          FROM folders
          GROUP BY accountid, folderPath
          HAVING COUNT(*) > 1
        ) dup
        ON f1.accountid = dup.accountid AND f1.folderPath = dup.folderPath
      )
      `
  );
  FolderDataCacheCounts();
  span.end();
}

export async function FolderDataGetCount(context: Span): Promise<number> {
  const span = OTelTracer().startSpan("FolderDataGetCount", context);
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM folders"
  );
  let count = 0;
  if (countRaw.length > 0) {
    count = countRaw[0].count;
  }
  span.end();
  return count;
}

// Private Functions

const FolderDataCacheCountsDebounced = debounce(async () => {
  const span = OTelTracer().startSpan("FolderDataCacheCounts");
  await FolderDataRefreshCacheFolders(span);
  await FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}, 500);

function FolderDataCacheCounts() {
  FolderDataCacheCountsDebounced();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(folderRaw: any): Folder {
  const folder = new Folder(folderRaw.accountId, folderRaw.folderpath);
  folder.id = folderRaw.id;
  folder.idCloud = folderRaw.idCloud;
  folder.dateSync = new Date(folderRaw.dateSync);
  folder.dateUpdated = new Date(folderRaw.dateUpdated);
  folder.info = folderRaw.info;
  return folder;
}
