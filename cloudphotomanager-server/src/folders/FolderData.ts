import { Span } from "@opentelemetry/sdk-trace-base";
import * as path from "path";
import { AccountDataList } from "../accounts/AccountData";
import { Folder } from "../model/Folder";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import debounce from "lodash/debounce";
import { OTelTracer } from "../OTelContext";
import { UtilsMd5 } from "../Utils";
import { SqlFolderSubtreePattern } from "../utils-std-ts/SqlLike";

let cacheAccountsFolders: any = {};
let cacheAccountsFoldersCounts: any = {};
let onCacheRefreshed: (() => void) | null = null;
const dirtyCountAccounts = new Set<string>();

export function FolderDataRegisterOnCacheRefreshed(fn: () => void): void {
  onCacheRefreshed = fn;
}

//
export async function FolderDataInit(context: Span) {
  const span = OTelTracer().startSpan("FolderData_init", context);
  await FolderDataRefreshCacheFolders(span);
  span.end();
}

// Never destroys a row for the same (accountId, folderpath): legacy rows with a
// non-md5 id are updated in place and the stored folder is returned so callers
// queue the id that actually exists.
export async function FolderDataAdd(
  context: Span,
  folder: Folder,
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderData_add", context);
  try {
    const existingRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND folderpath = ?",
      [folder.accountId, folder.folderpath],
    );
    if (existingRaw.length > 0) {
      const dateUpdated = folder.dateUpdated.toISOString();
      const dateSync = folder.dateSync.toISOString();
      const info = JSON.stringify(folder.info);
      const apply = SqlDbUtilsGetDatabase().transaction(() => {
        SqlDbUtilsExecSQL(
          span,
          "UPDATE folders SET idCloud = ?, dateUpdated = ?, dateSync = ?, info = ? " +
            " WHERE accountId = ? AND folderpath = ? ",
          [
            folder.idCloud,
            dateUpdated,
            dateSync,
            info,
            folder.accountId,
            folder.folderpath,
          ],
        );
      });
      apply();
      return fromRaw({
        ...existingRaw[0],
        idCloud: folder.idCloud,
        dateUpdated,
        dateSync,
        info,
      });
    }
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(
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
        ],
      );
    });
    apply();
    return folder;
  } finally {
    FolderDataCacheFoldersDebounced();
    span.end();
  }
}

export async function FolderDataGet(
  context: Span,
  id: string,
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGet", context);
  try {
    const folderRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE id = ?",
      [id],
    );
    if (folderRaw.length === 0) {
      return null;
    }
    return fromRaw(folderRaw[0]);
  } finally {
    span.end();
  }
}

export async function FolderDataGetByPath(
  context: Span,
  accountId: string,
  folderpath: string,
): Promise<Folder | null> {
  const span = OTelTracer().startSpan("FolderDataGetByPath", context);
  try {
    const folderRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND folderpath = ?",
      [accountId, folderpath],
    );
    if (folderRaw.length === 0) {
      return null;
    }
    return fromRaw(folderRaw[0]);
  } finally {
    span.end();
  }
}

// True when the folder itself or one of its descendants exists: used to guard
// a rename/move against overwriting an existing destination subtree.
export async function FolderDataSubtreeExists(
  context: Span,
  accountId: string,
  folderpath: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("FolderDataSubtreeExists", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT 1 FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\') LIMIT 1",
      [accountId, folderpath, SqlFolderSubtreePattern(folderpath)],
    );
    return rawData.length > 0;
  } finally {
    span.end();
  }
}

export async function FolderDataGetParent(
  context: Span,
  id: string,
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGetParent", context);
  try {
    const folderChildRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE id = ?",
      [id],
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
      [folderChild.accountId, path.dirname(folderChild.folderpath)],
    );
    if (folderParentRaw.length === 0) {
      return null;
    }
    return fromRaw(folderParentRaw[0]);
  } finally {
    span.end();
  }
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
    ],
  );
  FolderDataCacheFoldersDebounced();
  span.end();
}

export async function FolderDataGetByCloudId(
  context: Span,
  accountId: string,
  idCloud: string,
): Promise<Folder> {
  const span = OTelTracer().startSpan("FolderDataGetByCloudId", context);
  try {
    const folderRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND idCloud = ?",
      [accountId, idCloud],
    );
    if (folderRaw.length === 0) {
      return null;
    }
    return fromRaw(folderRaw[0]);
  } finally {
    span.end();
  }
}

// Direct children only: an indexed range query over the
// (accountId, folderpath) index instead of loading every folder of the account.
// '/' (0x2F) < '0' (0x30), so the upper bound excludes siblings that share the
// parent prefix without a separator ("/ab" vs parent "/a").
export async function FolderDataListSubFolders(
  context: Span,
  parentFolder: Folder,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataListSubFolders", context);
  const prefix =
    parentFolder.folderpath === "/" ? "/" : `${parentFolder.folderpath}/`;
  const upper = `${parentFolder.folderpath}0`;
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? AND folderpath > ? AND folderpath < ? ORDER BY folderpath",
    [parentFolder.accountId, prefix, upper],
  );
  const folders = [];
  rawData.forEach((folderRaw) => {
    const rest = folderRaw.folderpath.slice(prefix.length);
    if (rest.length > 0 && !rest.includes("/")) {
      folders.push(fromRaw(folderRaw));
    }
  });
  span.end();
  return folders;
}

export async function FolderDataListForAccount(
  context: Span,
  accountId: string,
  getCache = false,
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
    [accountId],
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
  getCache = false,
): Promise<{ folderId: string; count: number }[]> {
  const span = OTelTracer().startSpan(
    "FolderDataListCountsForAccount",
    context,
  );
  if (getCache) {
    span.addEvent("Cached");
    span.end();
    return cacheAccountsFoldersCounts[accountId];
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT count(*) as counts, folderId FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 GROUP BY folderId ",
    [accountId],
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
  id: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FolderDataDelete", context);
  await SqlDbUtilsExecSQL(
    span,
    "DELETE FROM folders WHERE accountId = ? AND id = ?",
    [accountId, id],
  );
  FolderDataCacheFoldersDebounced();
  span.end();
}

export async function FolderDataGetOlderThan(
  context: Span,
  accountId: string,
  ageLimit: Date,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetOlderThan", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? AND dateSync < ? ",
    [accountId, ageLimit.toISOString()],
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
  limit: number,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetOldestSync", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? ORDER BY dateSync ASC LIMIT ? ",
    [accountId, limit],
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
  limit: number,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetNewestSync", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? ORDER BY dateSync DESC LIMIT ? ",
    [accountId, limit],
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
  limit: number,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan("FolderDataGetNewstUpdate", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM folders WHERE accountId = ? " +
      " AND id IN ( SELECT folderId FROM files WHERE accountId = ? ORDER BY dateUpdated DESC LIMIT ? ) ",
    [accountId, accountId, limit],
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
  folderpath: string,
) {
  const span = OTelTracer().startSpan("FolderDataDeletePathRecursive", context);
  try {
    // Match the exact path or its "<path>/" subtree only. LIKE wildcards in
    // the path are escaped so "/2023" does not match "/2023-backup" and
    // literal "%"/"_" characters in folder names stay literal.
    const subtreePattern = SqlFolderSubtreePattern(folderpath);
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(
        span,
        "DELETE FROM files " +
          " WHERE accountId = ? " +
          " AND folderId IN ( SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\') ) ",
        [accountId, accountId, folderpath, subtreePattern],
      );
      SqlDbUtilsExecSQL(
        span,
        "DELETE FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\') ",
        [accountId, folderpath, subtreePattern],
      );
    });
    apply();
  } finally {
    FolderDataCacheFoldersDebounced();
    FolderDataCacheCountsMarkDirty(accountId);
    span.end();
  }
}

// Re-keys the folder subtree and its files in place so a rename keeps the
// row ids meaningful while preserving curation (favorites, trash, keywords),
// share links and permission grants. Returns the new root folder id and the
// file id moves (for moving the media cache directories).
export async function FolderDataRenameSubtree(
  context: Span,
  accountId: string,
  oldFolderpath: string,
  newFolderpath: string,
  newRootIdCloud: string | null,
): Promise<{ folderId: string; fileIdMoves: { from: string; to: string }[] }> {
  const span = OTelTracer().startSpan("FolderDataRenameSubtree", context);
  try {
    const subtreePattern = SqlFolderSubtreePattern(oldFolderpath);
    const folderRows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT id, folderpath, idCloud FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\') ORDER BY length(folderpath)",
      [accountId, oldFolderpath, subtreePattern],
    );
    if (folderRows.length === 0) {
      return { folderId: null, fileIdMoves: [] };
    }
    const folderIdMap = new Map<
      string,
      { newId: string; newPath: string; newIdCloud: string }
    >();
    for (const row of folderRows) {
      const newPath = newFolderpath + row.folderpath.slice(oldFolderpath.length);
      const newId = UtilsMd5(encodeURI(`${accountId}/${newPath}`));
      let newIdCloud = row.idCloud;
      if (row.folderpath === oldFolderpath && newRootIdCloud) {
        newIdCloud = newRootIdCloud;
      } else if (oldFolderpath !== "/") {
        // Path-based ids (local drive, S3 prefixes) end with the row's own
        // relative path; opaque ids (OneDrive) do not and stay unchanged.
        newIdCloud = rebaseCloudPath(row.idCloud, row.folderpath, newPath);
      }
      folderIdMap.set(row.id, { newId, newPath, newIdCloud });
    }

    const folderIds = folderRows.map((row) => row.id);
    const placeholders = folderIds.map(() => "?").join(", ");
    const fileRows = await SqlDbUtilsQuerySQL(
      span,
      `SELECT id, filename, folderId FROM files WHERE folderId IN (${placeholders})`,
      folderIds,
    );
    const fileIdMoves: { from: string; to: string }[] = [];
    const fileIdMap = new Map<string, string>();
    for (const row of fileRows) {
      const folder = folderIdMap.get(row.folderId);
      if (!folder) {
        continue;
      }
      const newFileId = UtilsMd5(
        encodeURI(`${accountId}/${folder.newId}/${row.filename}`),
      );
      if (newFileId !== row.id) {
        fileIdMap.set(row.id, newFileId);
        fileIdMoves.push({ from: row.id, to: newFileId });
      }
    }

    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(
        span,
        "CREATE TEMP TABLE IF NOT EXISTS _folder_id_map (oldId TEXT PRIMARY KEY, newId TEXT NOT NULL)",
      );
      SqlDbUtilsExecSQL(
        span,
        "CREATE TEMP TABLE IF NOT EXISTS _file_id_map (oldId TEXT PRIMARY KEY, newId TEXT NOT NULL)",
      );
      SqlDbUtilsExecSQL(span, "DELETE FROM _folder_id_map");
      SqlDbUtilsExecSQL(span, "DELETE FROM _file_id_map");
      for (const [oldId, folder] of folderIdMap) {
        SqlDbUtilsExecSQL(
          span,
          "INSERT INTO _folder_id_map (oldId, newId) VALUES (?, ?)",
          [oldId, folder.newId],
        );
      }
      for (const [oldId, newId] of fileIdMap) {
        SqlDbUtilsExecSQL(
          span,
          "INSERT INTO _file_id_map (oldId, newId) VALUES (?, ?)",
          [oldId, newId],
        );
      }
      SqlDbUtilsExecSQL(
        span,
        "UPDATE files SET folderId = (SELECT newId FROM _folder_id_map WHERE oldId = files.folderId) WHERE folderId IN (SELECT oldId FROM _folder_id_map)",
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE shares SET folderId = (SELECT newId FROM _folder_id_map WHERE oldId = shares.folderId) WHERE folderId IN (SELECT oldId FROM _folder_id_map)",
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE users_permissions " +
          "SET info = json_set(info, '$.folders', (" +
          "  SELECT json_group_array(" +
          "    json_set(je.value, '$.folderId'," +
          "      CASE" +
          "        WHEN EXISTS (SELECT 1 FROM _folder_id_map m WHERE m.oldId = json_extract(je.value, '$.folderId'))" +
          "        THEN (SELECT m.newId FROM _folder_id_map m WHERE m.oldId = json_extract(je.value, '$.folderId'))" +
          "        ELSE json_extract(je.value, '$.folderId')" +
          "      END" +
          "    )" +
          "  )" +
          "  FROM json_each(json_extract(users_permissions.info, '$.folders')) AS je" +
          ")) " +
          "WHERE EXISTS (" +
          "  SELECT 1 FROM json_each(json_extract(users_permissions.info, '$.folders')) AS je" +
          "  WHERE json_extract(je.value, '$.folderId') IN (SELECT oldId FROM _folder_id_map)" +
          ")",
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE files SET id = (SELECT newId FROM _file_id_map WHERE oldId = files.id) WHERE id IN (SELECT oldId FROM _file_id_map)",
      );
      for (const [oldId, folder] of folderIdMap) {
        SqlDbUtilsExecSQL(
          span,
          "UPDATE folders SET id = ?, folderpath = ?, idCloud = ? WHERE id = ?",
          [folder.newId, folder.newPath, folder.newIdCloud, oldId],
        );
      }
      SqlDbUtilsExecSQL(span, "DROP TABLE IF EXISTS _folder_id_map");
      SqlDbUtilsExecSQL(span, "DROP TABLE IF EXISTS _file_id_map");
    });
    apply();

    const root = folderIdMap.get(folderRows[0].id);
    return { folderId: root.newId, fileIdMoves };
  } finally {
    FolderDataCacheFoldersDebounced();
    FolderDataCacheCountsMarkDirty(accountId);
    span.end();
  }
}

export async function FolderDataRefreshCacheFolders(
  context: Span,
): Promise<void> {
  const span = OTelTracer().startSpan("FolderDataRefreshCacheFolders", context);
  const newCache: any = {};
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = await FolderDataListForAccount(span, account.id);
  }
  cacheAccountsFolders = newCache;
  await FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FolderDataRefreshCacheFoldersCounts(
  context: Span,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "FolderDataRefreshCacheFoldersCounts",
    context,
  );
  const newCache: any = {};
  const accounts = await AccountDataList(span);
  for (const account of accounts) {
    newCache[account.id] = await FolderDataListCountsForAccount(
      span,
      account.id,
    );
  }
  cacheAccountsFoldersCounts = newCache;
  span.end();
}

// Hot-path folder mutations mark their account dirty instead of running a
// full per-account GROUP BY scan per file. The debounced refresh aggregates
// each dirty account at most once per 500ms (max 5s under constant writes).
export function FolderDataCacheCountsMarkDirty(accountId: string): void {
  if (!accountId) {
    return;
  }
  dirtyCountAccounts.add(accountId);
  FolderDataCacheCountsDebounced();
}

// Test hook: flushes the pending debounced refreshes and waits for them.
export async function FolderDataCacheCountsFlush(): Promise<void> {
  await Promise.resolve(FolderDataCacheFoldersDebounced.flush());
  await Promise.resolve(FolderDataCacheCountsDebounced.flush());
}

export async function FolderDataGetCount(context: Span): Promise<number> {
  const span = OTelTracer().startSpan("FolderDataGetCount", context);
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM folders",
  );
  let count = 0;
  if (countRaw.length > 0) {
    count = countRaw[0].count;
  }
  span.end();
  return count;
}

// Private Functions

// Path-based provider ids (local drive absolute paths, S3 prefixes) end with
// the folder's relative path and can be rebased onto the new path. Opaque ids
// (OneDrive Graph item ids) do not, and must be kept unchanged.
function rebaseCloudPath(
  idCloud: string,
  rowFolderpath: string,
  rowNewFolderpath: string,
): string {
  if (
    typeof idCloud === "string" &&
    idCloud.endsWith(rowFolderpath)
  ) {
    return (
      idCloud.slice(0, idCloud.length - rowFolderpath.length) +
      rowNewFolderpath
    );
  }
  return idCloud;
}

const FolderDataCacheFoldersDebounced = debounce(
  async () => {
    const span = OTelTracer().startSpan("FolderDataCacheFolders");
    try {
      await FolderDataRefreshCacheFolders(span);
    } finally {
      span.end();
    }
    onCacheRefreshed?.();
  },
  500,
  { maxWait: 5000 },
);

const FolderDataCacheCountsDebounced = debounce(
  async () => {
    const span = OTelTracer().startSpan("FolderDataCacheCounts");
    try {
      const accounts = Array.from(dirtyCountAccounts);
      dirtyCountAccounts.clear();
      for (const accountId of accounts) {
        cacheAccountsFoldersCounts[accountId] =
          await FolderDataListCountsForAccount(span, accountId);
      }
    } finally {
      span.end();
    }
    onCacheRefreshed?.();
  },
  500,
  { maxWait: 5000 },
);

function fromRaw(folderRaw: any): Folder {
  const folder = new Folder(folderRaw.accountId, folderRaw.folderpath);
  folder.id = folderRaw.id;
  folder.idCloud = folderRaw.idCloud;
  folder.dateSync = new Date(folderRaw.dateSync);
  folder.dateUpdated = new Date(folderRaw.dateUpdated);
  folder.info = folderRaw.info;
  return folder;
}
