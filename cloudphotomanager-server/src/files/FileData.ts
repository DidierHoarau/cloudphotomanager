import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { FolderDataRefreshCacheFoldersCounts } from "../folders/FolderData";
import { File } from "../model/File";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";

let config: Config;

export async function FileDataInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("FileDataInit", context);
  config = configIn;
  span.end();
}

export async function FileDataGetFileCacheDir(
  context: Span,
  accountId: string,
  fileId: string
): Promise<string> {
  return `${config.DATA_DIR}/cache/${accountId}/${fileId[0]}/${fileId[1]}/${fileId}`;
}

export async function FileDataGetFileTmpDir(
  context: Span,
  accountId: string,
  fileId: string
): Promise<string> {
  return `${config.TMP_DIR}/cache/${accountId}/${Date.now()}_${fileId}`;
}

export async function FileDataGet(context: Span, id: string): Promise<File> {
  const span = OTelTracer().startSpan("FileDataGet", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE id = ? ",
    [id]
  );
  if (rawData.length === 0) {
    return null;
  }
  const file = fromRaw(rawData[0]);
  span.end();
  return file;
}

export async function FileDataGetByFolderId(
  context: Span,
  accountId: string,
  folderId: string,
  filename: string
): Promise<File> {
  const span = OTelTracer().startSpan("FileDataGetByFolderId", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND folderpath = folderId AND filename = ? ",
    [accountId, folderId, filename]
  );
  if (rawData.length === 0) {
    return null;
  }
  const file = fromRaw(rawData[0]);
  span.end();
  return file;
}

export async function FileDataListForAccount(
  context: Span,
  accountId: string
): Promise<File[]> {
  const span = OTelTracer().startSpan("FileDataListForAccount", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ?",
    [accountId]
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
  folderId: string
): Promise<File[]> {
  const span = OTelTracer().startSpan("FileDataListByFolder", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND folderId = ?",
    [accountId, folderId]
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
    ]
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
      file.hash,
      file.dateUpdated.toISOString(),
      file.dateSync.toISOString(),
      file.dateMedia.toISOString(),
      JSON.stringify(file.info),
      JSON.stringify(file.metadata),
      file.id,
    ]
  );
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FileDataUpdateKeywords(
  context: Span,
  file: File
): Promise<void> {
  const span = OTelTracer().startSpan("FileDataUpdateKeywords", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE files SET keywords = ?, info = ? WHERE id = ? ",
    [file.keywords, JSON.stringify(file.info), file.id]
  );
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FileDataDelete(context: Span, id: string): Promise<void> {
  const span = OTelTracer().startSpan("FileDataDelete", context);
  await SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE id = ?", [id]);
  FolderDataRefreshCacheFoldersCounts(span);
  span.end();
}

export async function FileDataGetCount(context: Span): Promise<number> {
  const span = OTelTracer().startSpan("FileDataGetCount", context);
  const countRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as count FROM files"
  );
  let count = 0;
  if (countRaw.length > 0) {
    count = countRaw[0].count;
  }
  span.end();
  return count;
}

// Private Funciton

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  return file;
}
