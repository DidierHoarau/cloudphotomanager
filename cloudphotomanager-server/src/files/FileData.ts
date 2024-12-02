import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { File } from "../model/File";
import { Config } from "../Config";
import { FolderDataRefreshCacheFoldersCounts } from "../folders/FolderData";

let config: Config;

export async function FileDataInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("FileData_init", context);
  config = configIn;
  span.end();
}

export async function FileDataGetFileCacheDir(context: Span, accountId: String, fileId: string): Promise<string> {
  const cacheDir = `${config.DATA_DIR}/cache/${accountId}/${fileId[0]}/${fileId[1]}/${fileId}`;
  return cacheDir;
}

export async function FileDataGetFileTmpDir(context: Span, accountId: String, fileId: string): Promise<string> {
  const cacheDir = `${config.TMP_DIR}/cache/${accountId}/${fileId[0]}/${fileId[1]}/${fileId}`;
  return cacheDir;
}

export async function FileDataGet(context: Span, id: string): Promise<File> {
  const span = StandardTracerStartSpan("FileData_getByPath", context);
  const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE id = ? ", [id]);
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
  const span = StandardTracerStartSpan("FileData_folderId", context);
  const rawData = await SqlDbutils.querySQL(
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

export async function FileDataListForAccount(context: Span, accountId: string): Promise<File[]> {
  const span = StandardTracerStartSpan("FileData_listForAccount", context);
  const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE accountId = ?", [accountId]);
  const files = [];
  rawData.forEach((fileRaw) => {
    files.push(fromRaw(fileRaw));
  });
  span.end();
  return files;
}

export async function FileDataListByFolder(context: Span, accountId: string, folderId: string): Promise<File[]> {
  const span = StandardTracerStartSpan("FileData_listForAccount", context);
  const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE accountId = ? AND folderId = ?", [
    accountId,
    folderId,
  ]);
  const files = [];
  rawData.forEach((fileRaw) => {
    files.push(fromRaw(fileRaw));
  });
  span.end();
  return files;
}

export async function FileDataAdd(context: Span, file: File): Promise<void> {
  const span = StandardTracerStartSpan("FileData_add", context);
  await SqlDbutils.execSQL(
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
  span.end();
  FolderDataRefreshCacheFoldersCounts();
}

export async function FileDataUpdate(context: Span, file: File): Promise<void> {
  const span = StandardTracerStartSpan("FileData_add", context);
  await SqlDbutils.execSQL(
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
  span.end();
  FolderDataRefreshCacheFoldersCounts();
}

export async function FileDataDelete(context: Span, id: string): Promise<void> {
  const span = StandardTracerStartSpan("FileData_delete", context);
  await SqlDbutils.execSQL(span, "DELETE FROM files WHERE id = ?", [id]);
  span.end();
  FolderDataRefreshCacheFoldersCounts();
}

// Private Funciton

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(fileRaw: any): File {
  const file = new File(fileRaw.accountId, fileRaw.folderId, fileRaw.filename);
  file.id = fileRaw.id;
  file.idCloud = fileRaw.idCloud;
  file.hash = fileRaw.hash;
  file.dateSync = new Date(fileRaw.dateSync);
  file.dateUpdated = new Date(fileRaw.dateUpdated);
  file.dateMedia = new Date(fileRaw.dateMedia);
  file.info = JSON.parse(fileRaw.info);
  file.metadata = JSON.parse(fileRaw.metadata);
  return file;
}
