import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { FolderDataRefreshCacheFoldersCounts } from "../folders/FolderData";
import { File } from "../model/File";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
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
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function FileDataGetByFolderId(
  context: Span,
  accountId: string,
  folderId: string,
  filename: string,
): Promise<File> {
  const span = OTelTracer().startSpan("FileDataGetByFolderId", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM files WHERE accountId = ? AND folderpath = folderId AND filename = ? ",
      [accountId, folderId, filename],
    );
    if (rawData.length === 0) {
      return null;
    }
    return fromRaw(rawData[0]);
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
    files.push(fromRaw(fileRaw));
  });
  span.end();
  return files;
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
    files.push(fromRaw(fileRaw));
  });
  span.end();
  return files;
}

export async function FileDataAdd(context: Span, file: File): Promise<void> {
  const span = OTelTracer().startSpan("FileDataAdd", context);
  await SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE id = ?", [file.id]);
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ",
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
  FolderDataRefreshCacheFoldersCounts(span);
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
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FileDataUpdateKeywords(
  context: Span,
  file: File,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdateKeywords", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET keywords = ?, info = ? WHERE id = ? ",
    [file.keywords, JSON.stringify(file.info), file.id],
  );
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FileDataUpdateInfo(
  context: Span,
  file: File,
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdateInfo", context);
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
): Promise<number> {
  const span = OTelTracer().startSpan("FileDataTrash", context);
  const rowsAffected = SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET trashed = 1, dateTrashed = ? WHERE id = ? AND COALESCE(trashed, 0) = 0 ",
    [new Date().toISOString(), fileId],
  );
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
  return rowsAffected;
}

// Restores a trashed file. Returns the number of rows actually restored.
export async function FileDataRestore(
  context: Span,
  fileId: string,
): Promise<number> {
  const span = OTelTracer().startSpan("FileDataRestore", context);
  const rowsAffected = SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET trashed = 0, dateTrashed = NULL WHERE id = ? AND COALESCE(trashed, 0) = 1 ",
    [fileId],
  );
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
  return rowsAffected;
}

export async function FileDataDelete(context: Span, id: string): Promise<void> {
  const span = OTelTracer().startSpan("FileDataDelete", context);
  await SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE id = ?", [id]);
  FolderDataRefreshCacheFoldersCounts(span);
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
    files.push(fromRaw(fileRaw));
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
  const folderpathSubPattern = folderpath === "/" ? `/%` : `${folderpath}/%`;
  const favoriteCondition = favoriteOnly
    ? " AND COALESCE(favorite, 0) = 1 "
    : "";
  // One pass for page + total: COUNT(*) OVER () avoids materializing the
  // folder subtree a second time just for the count. fromRaw() ignores the
  // extra column.
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    `SELECT *, COUNT(*) OVER () AS total FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0${favoriteCondition} AND folderId IN (SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ?)) ORDER BY dateMedia ${order}, id ${order} LIMIT ? OFFSET ?`,
    [accountId, accountId, folderpath, folderpathSubPattern, pageSize, offset],
  );
  let total = 0;
  const files: File[] = [];
  if (rawData.length > 0) {
    total = rawData[0].total;
    rawData.forEach((fileRaw) => {
      files.push(fromRaw(fileRaw));
    });
  } else if (offset > 0) {
    // An empty page past the end yields no row, so the window total is
    // unknown: fall back to the explicit count only in that rare path.
    const countRaw = await SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM files WHERE accountId = ? AND COALESCE(trashed, 0) = 0${favoriteCondition} AND folderId IN (SELECT id FROM folders WHERE accountId = ? AND (folderpath = ? OR folderpath LIKE ?))`,
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
  await SqlDbUtilsExecSQL(
    span,
    `DELETE FROM files
     WHERE accountId = ?
       AND folderId NOT IN (
         SELECT id FROM folders WHERE accountId = ?
       )`,
    [accountId, accountId],
  );
  FolderDataRefreshCacheFoldersCounts(span);
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
    files.push(fromRaw(fileRaw));
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
      files.push(fromRaw(fileRaw));
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
      files.push(fromRaw(fileRaw));
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

function fromRaw(fileRaw: any): File {
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
  file.syncGone = fileRaw.syncGone ?? 0;
  file.favorite = fileRaw.favorite ?? 0;
  file.trashed = fileRaw.trashed ?? 0;
  file.dateTrashed = fileRaw.dateTrashed
    ? new Date(fileRaw.dateTrashed)
    : null;
  return file;
}
