import { Span } from "@opentelemetry/sdk-trace-base";
import * as path from "path";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { Folder } from "../model/Folder";
import { AccountDataList } from "../accounts/AccountData";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheAccountsFolders: any[] = [];
let cacheAccountsFoldersInProgess = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheAccountsFoldersCounts: any[] = [];
let cacheAccountsFoldersCountsInProgess = 0;

//
export async function FolderDataInit(context: Span) {
  const span = StandardTracerStartSpan("FolderData_init", context);
  FolderDataRefreshCacheFolders();
  FolderDataRefreshCacheFoldersCounts();
  span.end();
}

export async function FolderDataAdd(context: Span, folder: Folder): Promise<void> {
  const span = StandardTracerStartSpan("FolderData_add", context);
  await SqlDbutils.execSQL(span, "DELETE FROM folders WHERE id = ? AND accountId = ?", [folder.id, folder.accountId]);
  await SqlDbutils.execSQL(
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
  span.end();
  FolderDataRefreshCacheFolders();
}

export async function FolderDataGet(context: Span, id: string): Promise<Folder> {
  const span = StandardTracerStartSpan("FolderDataGet", context);
  const folderRaw = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE id = ?", [id]);
  if (folderRaw.length === 0) {
    return null;
  }
  return fromRaw(folderRaw[0]);
}

export async function FolderDataGetParent(context: Span, id: string): Promise<Folder> {
  const span = StandardTracerStartSpan("FolderDataGetParent", context);
  const folderChildRaw = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE id = ?", [id]);
  if (folderChildRaw.length === 0) {
    return null;
  }
  const folderChild = fromRaw(folderChildRaw[0]);
  if (folderChild.folderpath === "/") {
    return null;
  }
  const folderParentRaw = await SqlDbutils.querySQL(
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
  const span = StandardTracerStartSpan("FolderDataUpdate", context);
  await SqlDbutils.execSQL(span, "UPDATE folders SET dateUpdated=?, dateSync=?, info=? WHERE id=? AND accountId=? ", [
    folder.dateUpdated.toISOString(),
    folder.dateSync.toISOString(),
    JSON.stringify(folder.info),
    folder.id,
    folder.accountId,
  ]);
  span.end();
  FolderDataRefreshCacheFolders();
}

export async function FolderDataGetByCloudId(context: Span, accountId: string, idCloud: string): Promise<Folder> {
  const span = StandardTracerStartSpan("FolderDataGetByCloudId", context);
  const folderRaw = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? AND idCloud = ?", [
    accountId,
    idCloud,
  ]);
  if (folderRaw.length === 0) {
    return null;
  }
  return fromRaw(folderRaw[0]);
}

export async function FolderDataListSubFolders(context: Span, parentFolder: Folder): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataListSubFolders", context);
  const accountfolders = await FolderDataListForAccount(span, parentFolder.accountId);
  const folders = [];

  accountfolders.forEach((candidateFolder) => {
    if (path.relative(`${candidateFolder.folderpath}/`, parentFolder.folderpath) === "..") {
      folders.push(fromRaw(candidateFolder));
    }
  });
  span.end();
  return folders;
}

export async function FolderDataListForAccount(context: Span, accountId: string, getCache = false): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataListForAccount", context);
  if (getCache) {
    span.addEvent("Cached");
    span.end();
    return cacheAccountsFolders[accountId];
  }
  const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? ORDER BY folderpath ", [
    accountId,
  ]);
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
  const span = StandardTracerStartSpan("FolderDataListCountsForAccount", context);
  if (getCache) {
    span.addEvent("Cached");
    span.end();
    return cacheAccountsFoldersCounts[accountId];
  }
  const rawData = await SqlDbutils.querySQL(
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

export async function FolderDataDelete(context: Span, accountId: string, id: string): Promise<void> {
  const span = StandardTracerStartSpan("FolderDataDelete", context);
  await SqlDbutils.execSQL(span, "DELETE FROM files WHERE accountId = ? AND id = ?", [accountId, id]);
  span.end();
}

export async function FolderDataGetOlderThan(context: Span, accountId: string, ageLimit: Date): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataGetOlderThan", context);
  const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? AND dateSync < ? ", [
    accountId,
    ageLimit.toISOString(),
  ]);
  const folders = [];
  rawData.forEach((folderRaw) => {
    folders.push(fromRaw(folderRaw));
  });
  span.end();
  return folders;
}

export async function FolderDataGetOldestSync(context: Span, accountId: string, limit: number): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataGetOldestSync", context);
  const rawData = await SqlDbutils.querySQL(
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

export async function FolderDataGetNewestSync(context: Span, accountId: string, limit: number): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataGetNewestSync", context);
  const rawData = await SqlDbutils.querySQL(
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

export async function FolderDataGetNewstUpdate(context: Span, accountId: string, limit: number): Promise<Folder[]> {
  const span = StandardTracerStartSpan("FolderDataGetNewstUpdate", context);
  const rawData = await SqlDbutils.querySQL(
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

export async function FolderDataDeletePathRecursive(context: Span, accountId: string, folderpath: string) {
  const span = StandardTracerStartSpan("FolderDataDeletePathRecursive", context);
  await SqlDbutils.execSQL(
    span,
    "DELETE FROM files " +
      " WHERE accountId = ? " +
      ` AND folderId IN ( SELECT id FROM folders WHERE accountId = ? AND folderpath LIKE ? ) `,
    [accountId, accountId, `${folderpath}%`]
  );
  await SqlDbutils.execSQL(span, `DELETE FROM folders WHERE accountId = ? AND folderpath LIKE ? `, [
    accountId,
    `${folderpath}%`,
  ]);
  span.end();
}

export async function FolderDataRefreshCacheFolders(): Promise<void> {
  console.log("cacheAccountsFoldersInProgess: "+cacheAccountsFoldersInProgess) 
  if (cacheAccountsFoldersInProgess > 1) {
    return;
  }
  cacheAccountsFoldersInProgess++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCache: any = {};
  const span = StandardTracerStartSpan("FolderDataRefreshCacheFolders");
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = FolderDataListForAccount(span, account.id);
  }
  cacheAccountsFolders = newCache;
  span.end();
  cacheAccountsFoldersInProgess--;
  FolderDataRefreshCacheFoldersCounts();
  setTimeout(() => {
    FolderDataRefreshCacheFolders();
  }, 60 * 1000);
}

export async function FolderDataRefreshCacheFoldersCounts(): Promise<void> {

  console.log("cacheAccountsFoldersCountsInProgess: " + cacheAccountsFoldersCountsInProgess);
  if (cacheAccountsFoldersCountsInProgess > 1) {
    return;
  }
  cacheAccountsFoldersCountsInProgess++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCache: any = {};
  const span = StandardTracerStartSpan("FolderDataRefreshCacheFoldersCounts");
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = FolderDataListCountsForAccount(span, account.id);
  }
  cacheAccountsFoldersCounts = newCache;
  span.end();
  cacheAccountsFoldersCountsInProgess--;
  setTimeout(() => {
    FolderDataRefreshCacheFoldersCounts();
  }, 60 * 1000);
}

// Private Functions

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
