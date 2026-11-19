import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { FolderDataCacheCountsMarkDirty } from "../folders/FolderData";
import { File } from "../model/File";
import { OTelTracer } from "../OTelContext";
import { UtilsMd5 } from "../Utils";
import { SqlEscapeLike } from "../utils-std-ts/SqlLike";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

let config: Config;

export async function FileDataInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("FileDataInit", context);
  config = configIn;
  span.end();
}

export async function FileDataGetFileCacheDir(
  context: Span,
  accountId: string,
  fileId: string,
): Promise<string> {
  return `${config.DATA_DIR}/cache/${accountId}/${fileId[0]}/${fileId[1]}/${fileId}`;
}

export async function FileDataGetFileTmpDir(
  context: Span,
  accountId: string,
  fileId: string,
): Promise<string> {
  return `${config.TMP_DIR}/cache/${accountId}/${Date.now()}_${fileId}`;
}

export async function FileDataGet(context: Span, id: string): Promise<File> {
  const span = OTelTracer().startSpan("FileDataGet", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM files WHERE id = ? ",
      [id],
    );
    if (rawData.length === 0) {
      return null;
    }
    return FileDataFromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function FileDataListForAccount(
  context: Span,
  accountId: string,
): Promise<File[]> {
  const span = OTelTracer().startSpan("FileDataListForAccount", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ?",
    [accountId],
  );
  const files = [];
  rawData.forEach((fileRaw) => {
    files.push(FileDataFromRaw(fileRaw));
  });
  span.end();
  return files;
}

// Ids only: the cache cleanup needs a membership set, not File objects.
export async function FileDataListIdsForAccount(
  context: Span,
  accountId: string,
): Promise<string[]> {
  const span = OTelTracer().startSpan("FileDataListIdsForAccount", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT id FROM files WHERE accountId = ?",
    [accountId],
  );
  span.end();
  return rawData.map((row: any) => row.id as string);
}

export async function FileDataListByFolder(
  context: Span,
  accountId: string,
  folderId: string,
  includeTrashed = false,
): Promise<File[]> {
  const span = OTelTracer().startSpan("FileDataListByFolder", context);
  // Cloud-sync reconciliation needs every row (trashed files still exist in
  // the cloud); UI listings only ever see non-trashed files.
  const trashedCondition = includeTrashed
    ? ""
    : " AND COALESCE(trashed, 0) = 0 ";
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND folderId = ?" +
      trashedCondition,
    [accountId, folderId],
  );
  const files = [];
  rawData.forEach((fileRaw) => {
    files.push(FileDataFromRaw(fileRaw));
  });
  span.end();
  return files;
}

export async function FileDataAdd(context: Span, file: File): Promise<void> {
  const span = OTelTracer().startSpan("FileDataAdd", context);
  // Upsert: a re-add of an existing id (same path) refreshes the sync fields
  // but must never reset curation state (favorite, trash, keywords).
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "  idCloud = excluded.idCloud, " +
      "  accountId = excluded.accountId, " +
      "  filename = excluded.filename, " +
      "  folderId = excluded.folderId, " +
      "  hash = excluded.hash, " +
      "  dateUpdated = excluded.dateUpdated, " +
      "  dateSync = excluded.dateSync, " +
      "  dateMedia = excluded.dateMedia, " +
      "  info = excluded.info, " +
      "  metadata = excluded.metadata, " +
      "  syncGone = 0, " +
      "  syncFailCount = 0, " +
      "  lastSyncError = NULL, " +
      "  lastSyncAttempt = NULL ",
    [
      file.id,
      file.idCloud,
      file.accountId,
      file.filename,
      file.folderId,
      file.hash || "",
      file.dateUpdated.toISOString(),
      file.dateSync.toISOString(),
      file.dateMedia ? file.dateMedia.toISOString() : null,
      JSON.stringify(file.info),
      JSON.stringify(file.metadata),
    ],
  );
  FolderDataCacheCountsMarkDirty(file.accountId);
  span.end();
}

export async function FileDataUpdate(context: Span, file: File): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdate", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files " +
      " SET idCloud = ?, accountId = ?, filename = ?, folderId = ?, hash = ?, " +
      "     dateUpdated = ?, dateSync = ?, dateMedia = ?, info = ?, metadata = ? " +
      " WHERE id = ? ",
    [
      file.idCloud,
      file.accountId,
      file.filename,
      file.folderId,
      file.hash || "",
      file.dateUpdated.toISOString(),
      file.dateSync.toISOString(),
      file.dateMedia.toISOString(),
      JSON.stringify(file.info),
      JSON.stringify(file.metadata),
      file.id,
    ],
  );
  FolderDataCacheCountsMarkDirty(file.accountId);
  span.end();
}

export async function FileDataUpdateKeywords(
  context: Span,
  file: File,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdateKeywords", context);
  // Keywords do not change any folder count: no cache work on this path.
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET keywords = ?, info = ? WHERE id = ? ",
    [file.keywords, JSON.stringify(file.info), file.id],
  );
  span.end();
}

// Persist the filename as keywords for an image that has none yet. This keeps
// filename search working before (or without) classification. The enrichment
// status is only initialized when it is still null: an `ok`/`failed`/`disabled`
// status is never overwritten here.
export async function FileDataBackfillFilenameKeywords(
  context: Span,
  file: File,
): Promise<string> {
  const span = OTelTracer().startSpan("FileDataBackfillFilenameKeywords", context);
  const keywords = `${file.filename ?? ""}`.toLowerCase();
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET keywords = ?, enrichmentStatus = COALESCE(enrichmentStatus, 'pending') " +
      "WHERE id = ? AND (keywords IS NULL OR keywords = '')",
    [keywords, file.id],
  );
  span.end();
  file.keywords = keywords;
  return keywords;
}

export async function FileDataRecordEnrichmentSuccess(
  context: Span,
  fileId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataRecordEnrichmentSuccess", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET enrichmentStatus = 'ok', lastEnrichmentError = NULL, " +
      "lastEnrichmentAttempt = ?, enrichmentFailCount = 0 WHERE id = ?",
    [new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataRecordEnrichmentFailure(
  context: Span,
  fileId: string,
  errorMessage: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataRecordEnrichmentFailure", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET enrichmentStatus = 'failed', lastEnrichmentError = ?, " +
      "lastEnrichmentAttempt = ?, " +
      "enrichmentFailCount = COALESCE(enrichmentFailCount, 0) + 1 " +
      "WHERE id = ?",
    [errorMessage, new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataRecordEnrichmentPending(
  context: Span,
  fileId: string,
  reason: string | null,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataRecordEnrichmentPending", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET enrichmentStatus = 'pending', lastEnrichmentError = ?, " +
      "lastEnrichmentAttempt = ? WHERE id = ?",
    [reason, new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataRecordEnrichmentDisabled(
  context: Span,
  fileId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataRecordEnrichmentDisabled", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET enrichmentStatus = 'disabled', lastEnrichmentError = NULL, " +
      "lastEnrichmentAttempt = ? WHERE id = ?",
    [new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataUpdateInfo(
  context: Span,
  file: File,
): Promise<void> {  const span = OTelTracer().startSpan("FileDataUpdateInfo", context);
  await SqlDbUtilsExecSQL(span, "UPDATE files SET info = ? WHERE id = ? ", [
    JSON.stringify(file.info),
    file.id,
  ]);
  span.end();
}

export async function FileDataUpdateFavorite(
  context: Span,
  fileId: string,
  favorite: boolean,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdateFavorite", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET favorite = ? WHERE id = ? ",
    [favorite ? 1 : 0, fileId],
  );
  span.end();
}

// Moves a file to the trash (DB-only soft delete). Returns the number of rows
// actually trashed: 0 when the file does not exist or is already trashed.
export async function FileDataTrash(
  context: Span,
  fileId: string,
  accountId: string,
): Promise<number> {
  const span = OTelTracer().startSpan("FileDataTrash", context);
  const rowsAffected = SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET trashed = 1, dateTrashed = ? WHERE id = ? AND COALESCE(trashed, 0) = 0 ",
    [new Date().toISOString(), fileId],
  );
  if (rowsAffected > 0) {
    FolderDataCacheCountsMarkDirty(accountId);
  }
  span.end();
  return rowsAffected;
}

// Restores a trashed file. Returns the number of rows actually restored.
export async function FileDataRestore(
  context: Span,
  fileId: string,
  accountId: string,
): Promise<number> {
  const span = OTelTracer().startSpan("FileDataRestore", context);
  const rowsAffected = SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET trashed = 0, dateTrashed = NULL WHERE id = ? AND COALESCE(trashed, 0) = 1 ",
    [fileId],
  );
  if (rowsAffected > 0) {
    FolderDataCacheCountsMarkDirty(accountId);
  }
  span.end();
  return rowsAffected;
}

export async function FileDataDelete(
  context: Span,
  id: string,
  accountId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataDelete", context);
  // Album memberships and covers must not outlive the file row; a cover falls
  // back to none so the album stays valid.
  const apply = SqlDbUtilsGetDatabase().transaction(() => {
    SqlDbUtilsExecSQL(span, "DELETE FROM album_items WHERE fileId = ?", [id]);
    SqlDbUtilsExecSQL(
      span,
      "UPDATE albums SET coverFileId = NULL WHERE coverFileId = ?",
      [id],
    );
    SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE id = ?", [id]);
  });
  apply();
  FolderDataCacheCountsMarkDirty(accountId);
  span.end();
}

// Returns the post-increment consecutive-failure count so callers can detect
// the retry-cap transition (fires the persistent-failure webhook exactly once
// per failure streak).
export async function FileDataRecordSyncFailure(
  context: Span,
  fileId: string,
  errorMessage: string,
): Promise<number | null> {
  const span = OTelTracer().startSpan("FileDataRecordSyncFailure", context);
  try {
    await SqlDbUtilsExecSQL(
      span,
      "UPDATE files " +
        " SET syncFailCount = COALESCE(syncFailCount, 0) + 1, lastSyncError = ?, lastSyncAttempt = ?" +
        " WHERE id = ? ",
      [errorMessage, new Date().toISOString(), fileId],
    );
    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT syncFailCount FROM files WHERE id = ?",
      [fileId],
    );
    return rows.length > 0 ? rows[0].syncFailCount : null;
  } finally {
    span.end();
  }
}

export async function FileDataRecordSyncSuccess(
  context: Span,
  fileId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataRecordSyncSuccess", context);
  // Only touch rows that previously recorded a failure or a gone tombstone,
  // to avoid a write on every successful sync. A success proves the item is
  // alive in the cloud, so it also clears a stale syncGone marker.
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files " +
      " SET syncFailCount = 0, lastSyncError = NULL, lastSyncAttempt = ?, syncGone = 0" +
      " WHERE id = ? AND (COALESCE(syncFailCount, 0) > 0 OR COALESCE(syncGone, 0) > 0)",
    [new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataMarkSyncGone(
  context: Span,
  fileId: string,
  errorMessage: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataMarkSyncGone", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files " +
      " SET syncGone = 1, lastSyncError = ?, lastSyncAttempt = ?" +
      " WHERE id = ? ",
    [errorMessage, new Date().toISOString(), fileId],
  );
  span.end();
}

export async function FileDataClearSyncGone(
  context: Span,
  fileId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataClearSyncGone", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET syncGone = 0 WHERE id = ? AND COALESCE(syncGone, 0) > 0",
    [fileId],
  );
  span.end();
}

export async function FileDataGetCount(context: Span): Promise<number> {
  const span = OTelTracer().startSpan("FileDataGetCount", context);
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM files",
  );
  let count = 0;
  if (countRaw.length > 0) {
    count = countRaw[0].count;
  }
  span.end();
  return count;
}

// Count and total size (from the recorded file info) of the non-trashed files
// in one folder or a whole subtree, with the same optional grant filter used
// by the listings.
export async function FileDataStatsForFolderSubtree(
  context: Span,
  accountId: string,
  folderpath: string,
  permittedFolderIds: string[] | null = null,
): Promise<{ count: number; size: number }> {
  const span = OTelTracer().startSpan("FileData_statsForFolderSubtree", context);
  try {
    const subtreePrefix = folderpath === "/" ? "/" : `${folderpath}/`;
    const subtreePattern = `${SqlEscapeLike(subtreePrefix)}%`;
    const filter =
      permittedFolderIds === null
        ? ""
        : " AND folderId IN (SELECT value FROM json_each(?)) ";
    const params: any[] = [accountId, accountId, folderpath, subtreePattern];
    if (permittedFolderIds !== null) {
      params.push(JSON.stringify(permittedFolderIds));
    }
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) AS count, COALESCE(SUM(CAST(json_extract(info, '$.size') AS INTEGER)), 0) AS size " +
        "FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 " +
        "AND folderId IN (SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\'))" +
        filter,
      params,
    );
    return statsFromRows(rows);
  } finally {
    span.end();
  }
}

export async function FileDataStatsForFolder(
  context: Span,
  accountId: string,
  folderId: string,
  permittedFolderIds: string[] | null = null,
): Promise<{ count: number; size: number }> {
  const span = OTelTracer().startSpan("FileData_statsForFolder", context);
  try {
    const filter =
      permittedFolderIds === null
        ? ""
        : " AND folderId IN (SELECT value FROM json_each(?)) ";
    const params: any[] = [accountId, folderId];
    if (permittedFolderIds !== null) {
      params.push(JSON.stringify(permittedFolderIds));
    }
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) AS count, COALESCE(SUM(CAST(json_extract(info, '$.size') AS INTEGER)), 0) AS size " +
        "FROM files WHERE accountId = ? AND folderId = ? AND COALESCE(trashed, 0) = 0" +
        filter,
      params,
    );
    return statsFromRows(rows);
  } finally {
    span.end();
  }
}

function statsFromRows(rows: any[]): { count: number; size: number } {
  if (rows.length === 0) {
    return { count: 0, size: 0 };
  }
  return {
    count: Number(rows[0].count) || 0,
    size: Number(rows[0].size) || 0,
  };
}

// Re-keys a file after a rename/move: only id, folderId and filename change,
// so curation (favorite, trash, keywords) and sync state survive. Returns the
// new id (unchanged when the derived id is the same).
export async function FileDataReKey(
  context: Span,
  fileId: string,
  newFolderId: string,
  newFilename: string,
): Promise<string> {
  const span = OTelTracer().startSpan("FileDataReKey", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT accountId, folderId FROM files WHERE id = ?",
      [fileId],
    );
    if (rawData.length === 0) {
      return fileId;
    }
    const accountId = rawData[0].accountId as string;
    const oldFolderId = rawData[0].folderId as string;
    const newFileId = UtilsMd5(
      encodeURI(`${accountId}/${newFolderId}/${newFilename}`),
    );
    if (newFileId === fileId) {
      return fileId;
    }
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      // A stale row already at the destination would violate the id UNIQUE
      // constraint: the cloud listing is authoritative for the moved item.
      SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE id = ?", [newFileId]);
      // Album memberships and single-file shares follow the file id; a cover
      // pointing at the moved file stays on the same photo. The destination's
      // stale membership (if any) is dropped first to avoid a primary-key
      // conflict.
      SqlDbUtilsExecSQL(span, "DELETE FROM album_items WHERE fileId = ?", [
        newFileId,
      ]);
      SqlDbUtilsExecSQL(
        span,
        "UPDATE album_items SET fileId = ? WHERE fileId = ?",
        [newFileId, fileId],
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE albums SET coverFileId = ? WHERE coverFileId = ?",
        [newFileId, fileId],
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE shares SET fileId = ? WHERE scope = 'file' AND fileId = ?",
        [newFileId, fileId],
      );
      SqlDbUtilsExecSQL(
        span,
        "UPDATE files SET id = ?, folderId = ?, filename = ? WHERE id = ?",
        [newFileId, newFolderId, newFilename, fileId],
      );
    });
    apply();
    if (oldFolderId !== newFolderId) {
      FolderDataCacheCountsMarkDirty(accountId);
    }
    return newFileId;
  } finally {
    span.end();
  }
}

export async function FileDataListByFolderPaginated(
  context: Span,
  accountId: string,
  folderId: string,
  sortOrder: "asc" | "desc",
  page: number,
  pageSize: number,
  favoriteOnly = false,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan("FileDataListByFolderPaginated", context);
  const order = sortOrder === "asc" ? "ASC" : "DESC";
  const offset = page * pageSize;
  const favoriteCondition = favoriteOnly
    ? " AND COALESCE(favorite, 0) = 1 "
    : "";
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM files WHERE accountId = ? AND folderId = ? AND COALESCE(trashed, 0) = 0" +
      favoriteCondition,
    [accountId, folderId],
  );
  const total = countRaw.length > 0 ? countRaw[0].count : 0;
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT * FROM files WHERE accountId = ? AND folderId = ? AND COALESCE(trashed, 0) = 0${favoriteCondition} ORDER BY dateMedia ${order}, id ${order} LIMIT ? OFFSET ?`,
    [accountId, folderId, pageSize, offset],
  );
  const files: File[] = [];
  rawData.forEach((fileRaw) => {
    files.push(FileDataFromRaw(fileRaw));
  });
  span.end();
  return { files, total };
}

export async function FileDataListByFolderRecursivePaginated(
  context: Span,
  accountId: string,
  folderpath: string,
  sortOrder: "asc" | "desc",
  page: number,
  pageSize: number,
  favoriteOnly = false,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan(
    "FileDataListByFolderRecursivePaginated",
    context,
  );
  const order = sortOrder === "asc" ? "ASC" : "DESC";
  const offset = page * pageSize;
  // Escape the path prefix, then append the wildcard: names containing % or _
  // must match literally and must not widen the subtree selection.
  const subtreePrefix = folderpath === "/" ? "/" : `${folderpath}/`;
  const folderpathSubPattern = `${SqlEscapeLike(subtreePrefix)}%`;
  const favoriteCondition = favoriteOnly
    ? " AND COALESCE(favorite, 0) = 1 "
    : "";
  // One pass for page + total: COUNT(*) OVER () avoids materializing the
  // folder subtree a second time just for the count. FileDataFromRaw() ignores the
  // extra column.
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT *, COUNT(*) OVER () AS total FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0${favoriteCondition} AND folderId IN (SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\')) ORDER BY dateMedia ${order}, id ${order} LIMIT ? OFFSET ?`,
    [accountId, accountId, folderpath, folderpathSubPattern, pageSize, offset],
  );
  let total = 0;
  const files: File[] = [];
  if (rawData.length > 0) {
    total = rawData[0].total;
    rawData.forEach((fileRaw) => {
      files.push(FileDataFromRaw(fileRaw));
    });
  } else if (offset > 0) {
    // An empty page past the end yields no row, so the window total is
    // unknown: fall back to the explicit count only in that rare path.
    const countRaw = await SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0${favoriteCondition} AND folderId IN (SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\'))`,
      [accountId, accountId, folderpath, folderpathSubPattern],
    );
    total = countRaw.length > 0 ? countRaw[0].count : 0;
  }
  span.end();
  return { files, total };
}

export async function FileDataDeleteNoFolder(
  context: Span,
  accountId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataDeleteNoFolder", context);
  const orphanCondition =
    "SELECT id FROM files WHERE accountId = ? AND folderId NOT IN (SELECT id FROM folders WHERE accountId = ?)";
  const params = [accountId, accountId];
  const apply = SqlDbUtilsGetDatabase().transaction(() => {
    SqlDbUtilsExecSQL(
      span,
      `DELETE FROM album_items WHERE fileId IN (${orphanCondition})`,
      params,
    );
    SqlDbUtilsExecSQL(
      span,
      `UPDATE albums SET coverFileId = NULL WHERE coverFileId IN (${orphanCondition})`,
      params,
    );
    SqlDbUtilsExecSQL(
      span,
      `DELETE FROM files
       WHERE accountId = ?
         AND folderId NOT IN (
           SELECT id FROM folders WHERE accountId = ?
         )`,
      params,
    );
  });
  apply();
  FolderDataCacheCountsMarkDirty(accountId);
  span.end();
}

export async function FileDataListForAccountPaginated(
  context: Span,
  accountId: string,
  page: number,
  pageSize: number,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan(
    "FileDataListForAccountPaginated",
    context,
  );
  const offset = page * pageSize;
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0",
    [accountId],
  );
  const total = countRaw.length > 0 ? countRaw[0].count : 0;
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 ORDER BY dateMedia DESC, id DESC LIMIT ? OFFSET ?",
    [accountId, pageSize, offset],
  );
  const files: File[] = [];
  rawData.forEach((fileRaw) => {
    files.push(FileDataFromRaw(fileRaw));
  });
  span.end();
  return { files, total };
}

export async function FileDataListTrashPaginated(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null,
  page: number,
  pageSize: number,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan("FileDataListTrashPaginated", context);
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const params: any[] = [accountId];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  params.push(pageSize, page * pageSize);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT *, COUNT(*) OVER () AS total FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 1${folderFilterSql} ORDER BY dateTrashed DESC, id DESC LIMIT ? OFFSET ?`,
    params,
  );
  let total = 0;
  const files: File[] = [];
  if (rawData.length > 0) {
    total = rawData[0].total;
    rawData.forEach((fileRaw) => {
      files.push(FileDataFromRaw(fileRaw));
    });
  } else if (page > 0) {
    const countRaw = await SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 1${folderFilterSql}`,
      params.slice(0, permittedFolderIds === null ? 1 : 2),
    );
    total = countRaw.length > 0 ? countRaw[0].count : 0;
  }
  span.end();
  return { files, total };
}

export async function FileDataListExpiredTrash(
  context: Span,
  cutoffIso: string,
): Promise<string[]> {
  const span = OTelTracer().startSpan("FileDataListExpiredTrash", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT id FROM files WHERE COALESCE(trashed, 0) = 1 AND dateTrashed IS NOT NULL AND dateTrashed < ? ",
    [cutoffIso],
  );
  span.end();
  return rawData.map((row: any) => row.id);
}

export async function FileDataListAccountMonths(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null,
): Promise<{ year: number; month: number; count: number }[]> {
  const span = OTelTracer().startSpan("FileDataListAccountMonths", context);
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const params: any[] = [accountId];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT substr(dateMedia, 1, 4) AS year, substr(dateMedia, 6, 2) AS month, COUNT(*) AS count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 AND dateMedia IS NOT NULL${folderFilterSql} GROUP BY year, month ORDER BY year DESC, month DESC`,
    params,
  );
  span.end();
  return rawData.map((row: any) => ({
    year: Number(row.year),
    month: Number(row.month),
    count: Number(row.count),
  }));
}

export async function FileDataListByMonthPaginated(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null,
  monthStartIso: string,
  monthEndIsoExclusive: string,
  sortOrder: "asc" | "desc",
  page: number,
  pageSize: number,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan("FileDataListByMonthPaginated", context);
  const order = sortOrder === "asc" ? "ASC" : "DESC";
  const offset = page * pageSize;
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const params: any[] = [
    accountId,
    monthStartIso,
    monthEndIsoExclusive,
  ];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  params.push(pageSize, offset);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT *, COUNT(*) OVER () AS total FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 AND dateMedia >= ? AND dateMedia < ?${folderFilterSql} ORDER BY dateMedia ${order}, id ${order} LIMIT ? OFFSET ?`,
    params,
  );
  let total = 0;
  const files: File[] = [];
  if (rawData.length > 0) {
    total = rawData[0].total;
    rawData.forEach((fileRaw) => {
      files.push(FileDataFromRaw(fileRaw));
    });
  } else if (page > 0) {
    const countParams: any[] = [accountId, monthStartIso, monthEndIsoExclusive];
    if (permittedFolderIds !== null) {
      countParams.push(JSON.stringify(permittedFolderIds));
    }
    const countRaw = await SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0 AND dateMedia >= ? AND dateMedia < ?${folderFilterSql}`,
      countParams,
    );
    total = countRaw.length > 0 ? countRaw[0].count : 0;
  }
  span.end();
  return { files, total };
}

// Private Funciton

// Images (including RAW) as understood by File.getMediaType: used by the
// library-health queries and the legacy migration backfill.
export const FILE_IMAGE_SQL_CONDITION =
  "(" +
  ["jpg", "jpeg", "png", "gif", "webp", "tiff", "dng", "raw", "arw", "heic"]
    .map((ext) => `LOWER(filename) LIKE '%.${ext}'`)
    .join(" OR ") +
  ")";

export interface EnrichmentAccountHealth {
  accountId: string;
  totalImages: number;
  missingKeywords: number;
  ok: number;
  failed: number;
  pending: number;
  disabled: number;
  atRetryCap: number;
}

export interface EnrichmentHealth {
  accounts: EnrichmentAccountHealth[];
  totals: Omit<EnrichmentAccountHealth, "accountId">;
  lastEnrichmentError: {
    accountId: string;
    error: string;
    date: string;
  } | null;
  retryCap: { cause: string; count: number }[];
  oldestWaitingItem: {
    id: string;
    functionName: string;
    priority: number;
    dateCreated: string;
  } | null;
}

export async function FileDataGetEnrichmentHealth(
  context: Span,
): Promise<EnrichmentHealth> {
  const span = OTelTracer().startSpan("FileDataGetEnrichmentHealth", context);
  try {
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT accountId, COUNT(*) AS totalImages, " +
        "SUM(CASE WHEN keywords IS NULL OR keywords = '' THEN 1 ELSE 0 END) AS missingKeywords, " +
        "SUM(CASE WHEN enrichmentStatus = 'ok' THEN 1 ELSE 0 END) AS okCount, " +
        "SUM(CASE WHEN enrichmentStatus = 'failed' THEN 1 ELSE 0 END) AS failedCount, " +
        "SUM(CASE WHEN enrichmentStatus = 'pending' THEN 1 ELSE 0 END) AS pendingCount, " +
        "SUM(CASE WHEN enrichmentStatus = 'disabled' THEN 1 ELSE 0 END) AS disabledCount, " +
        "SUM(CASE WHEN COALESCE(syncFailCount, 0) >= 5 THEN 1 ELSE 0 END) AS atRetryCap " +
        "FROM files WHERE COALESCE(trashed, 0) = 0 AND " +
        FILE_IMAGE_SQL_CONDITION +
        " GROUP BY accountId ORDER BY accountId",
    );
    const accounts: EnrichmentAccountHealth[] = rows.map((row: any) => ({
      accountId: row.accountId,
      totalImages: Number(row.totalImages) || 0,
      missingKeywords: Number(row.missingKeywords) || 0,
      ok: Number(row.okCount) || 0,
      failed: Number(row.failedCount) || 0,
      pending: Number(row.pendingCount) || 0,
      disabled: Number(row.disabledCount) || 0,
      atRetryCap: Number(row.atRetryCap) || 0,
    }));
    const totals = accounts.reduce(
      (acc, account) => ({
        totalImages: acc.totalImages + account.totalImages,
        missingKeywords: acc.missingKeywords + account.missingKeywords,
        ok: acc.ok + account.ok,
        failed: acc.failed + account.failed,
        pending: acc.pending + account.pending,
        disabled: acc.disabled + account.disabled,
        atRetryCap: acc.atRetryCap + account.atRetryCap,
      }),
      {
        totalImages: 0,
        missingKeywords: 0,
        ok: 0,
        failed: 0,
        pending: 0,
        disabled: 0,
        atRetryCap: 0,
      },
    );

    const lastErrorRows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT accountId, lastEnrichmentError, lastEnrichmentAttempt FROM files " +
        "WHERE lastEnrichmentError IS NOT NULL AND COALESCE(trashed, 0) = 0 AND " +
        FILE_IMAGE_SQL_CONDITION +
        " ORDER BY lastEnrichmentAttempt DESC LIMIT 1",
    );
    const lastEnrichmentError =
      lastErrorRows.length > 0
        ? {
            accountId: lastErrorRows[0].accountId,
            error: lastErrorRows[0].lastEnrichmentError,
            date: lastErrorRows[0].lastEnrichmentAttempt,
          }
        : null;

    const retryCapRows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COALESCE(lastSyncError, 'Unknown error') AS cause, COUNT(*) AS count " +
        "FROM files WHERE COALESCE(trashed, 0) = 0 AND syncFailCount >= 5 " +
        "GROUP BY cause ORDER BY count DESC LIMIT 20",
    );
    const retryCap = retryCapRows.map((row: any) => ({
      cause: row.cause,
      count: Number(row.count) || 0,
    }));

    const waitingRows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT id, functionName, priority, dateCreated FROM sync_queue " +
        "WHERE status = 'WAITING' ORDER BY dateCreated ASC LIMIT 1",
    );
    const oldestWaitingItem =
      waitingRows.length > 0
        ? {
            id: waitingRows[0].id,
            functionName: waitingRows[0].functionName,
            priority: Number(waitingRows[0].priority) || 0,
            dateCreated: waitingRows[0].dateCreated,
          }
        : null;

    return { accounts, totals, lastEnrichmentError, retryCap, oldestWaitingItem };
  } finally {
    span.end();
  }
}

export interface EnrichmentRetryScope {
  accountId?: string;
  folderId?: string;
  folderpath?: string;
  fileId?: string;
}

export interface EnrichmentRetryCandidate {
  id: string;
  accountId: string;
}

// Resets the enrichment state of the files in scope and returns them so the
// caller can re-queue them. Only images still needing enrichment (pending,
// failed or never attempted) are selected: trashed and tombstoned files are
// skipped, and media sync counters are left untouched.
export async function FileDataResetEnrichment(
  context: Span,
  scope: EnrichmentRetryScope,
): Promise<EnrichmentRetryCandidate[]> {
  const span = OTelTracer().startSpan("FileDataResetEnrichment", context);
  try {
    const conditions: string[] = [
      "COALESCE(trashed, 0) = 0",
      "COALESCE(syncGone, 0) = 0",
      "(enrichmentStatus IS NULL OR enrichmentStatus IN ('failed', 'pending'))",
      FILE_IMAGE_SQL_CONDITION,
    ];
    const params: any[] = [];
    if (scope.fileId) {
      conditions.push("id = ?");
      params.push(scope.fileId);
    }
    if (scope.accountId) {
      conditions.push("accountId = ?");
      params.push(scope.accountId);
    }
    if (scope.folderId && scope.folderpath !== undefined) {
      const subtreePrefix =
        scope.folderpath === "/" ? "/" : `${scope.folderpath}/`;
      const subPattern = `${SqlEscapeLike(subtreePrefix)}%`;
      conditions.push(
        "folderId IN (SELECT id FROM folders WHERE accountId = ? " +
          "AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\'))",
      );
      params.push(scope.accountId, scope.folderpath, subPattern);
    } else if (scope.folderId) {
      conditions.push("folderId = ?");
      params.push(scope.folderId);
    }
    const where = conditions.join(" AND ");
    await SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET enrichmentStatus = 'pending', lastEnrichmentError = NULL, " +
        "lastEnrichmentAttempt = NULL, enrichmentFailCount = 0 WHERE " +
        where,
      params,
    );
    const rows = await SqlDbUtilsQuerySQL(
      span,
      `SELECT id, accountId FROM files WHERE ${where}`,
      params,
    );
    return rows.map((row: any) => ({ id: row.id, accountId: row.accountId }));
  } finally {
    span.end();
  }
}

export function FileDataFromRaw(fileRaw: any): File {
  const file = new File(fileRaw.accountId, fileRaw.folderId, fileRaw.filename);
  file.id = fileRaw.id;
  file.idCloud = fileRaw.idCloud;
  file.hash = fileRaw.hash;
  file.keywords = fileRaw.keywords;
  file.dateSync = new Date(fileRaw.dateSync);
  file.dateUpdated = new Date(fileRaw.dateUpdated);
  file.dateMedia = new Date(fileRaw.dateMedia);
  file.info = JSON.parse(fileRaw.info);
  file.metadata = JSON.parse(fileRaw.metadata);
  file.syncFailCount = fileRaw.syncFailCount ?? 0;
  file.lastSyncError = fileRaw.lastSyncError ?? null;
  file.lastSyncAttempt = fileRaw.lastSyncAttempt
    ? new Date(fileRaw.lastSyncAttempt)
    : null;
  file.enrichmentStatus = fileRaw.enrichmentStatus ?? null;
  file.lastEnrichmentError = fileRaw.lastEnrichmentError ?? null;
  file.lastEnrichmentAttempt = fileRaw.lastEnrichmentAttempt
    ? new Date(fileRaw.lastEnrichmentAttempt)
    : null;
  file.enrichmentFailCount = fileRaw.enrichmentFailCount ?? 0;
  file.syncGone = fileRaw.syncGone ?? 0;
  file.favorite = fileRaw.favorite ?? 0;
  file.trashed = fileRaw.trashed ?? 0;
  file.dateTrashed = fileRaw.dateTrashed
    ? new Date(fileRaw.dateTrashed)
    : null;
  return file;
}
