import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { File } from "../model/File";
import { Config } from "../Config";

let config: Config;

export class FileData {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("FileData_init", context);
    config = configIn;
    span.end();
  }

  public static async getFileCacheDir(context: Span, fileId: string): Promise<string> {
    const cacheDir = `${config.DATA_DIR}/cache/${fileId[0]}/${fileId[1]}/${fileId}`;
    return cacheDir;
  }

  public static async getByPath(context: Span, accountId: string, folderpath: string, filename: string): Promise<File> {
    const span = StandardTracer.startSpan("FileData_getByPath", context);
    const rawData = await SqlDbutils.querySQL(
      span,
      "SELECT * FROM files WHERE accountId = ? AND folderpath = ? AND filename = ? ",
      [accountId, folderpath, filename]
    );
    if (rawData.length === 0) {
      return null;
    }
    const file = fromRaw(rawData[0]);
    span.end();
    return file;
  }

  public static async listForAccount(context: Span, accountId: string): Promise<File[]> {
    const span = StandardTracer.startSpan("FileData_listForAccount", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE accountId = ?", [accountId]);
    const files = [];
    rawData.forEach((fileRaw) => {
      files.push(fromRaw(fileRaw));
    });
    span.end();
    return files;
  }

  public static async listAccountFolder(context: Span, accountId: string, folderpath: string): Promise<File[]> {
    const span = StandardTracer.startSpan("FileData_listForAccount", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE accountId = ? AND folderpath = ?", [
      accountId,
      folderpath,
    ]);
    const files = [];
    rawData.forEach((fileRaw) => {
      files.push(fromRaw(fileRaw));
    });
    span.end();
    return files;
  }

  public static async add(context: Span, file: File): Promise<void> {
    const span = StandardTracer.startSpan("FileData_add", context);
    await SqlDbutils.execSQL(
      span,
      "INSERT INTO files (id, idCloud, accountId, filename, folderpath, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ",
      [
        file.id,
        file.idCloud,
        file.accountId,
        file.filename,
        file.folderpath,
        file.hash,
        file.dateUpdated,
        file.dateSync,
        file.dateMedia,
        JSON.stringify(file.info),
        JSON.stringify(file.metadata),
      ]
    );
    span.end();
  }

  public static async update(context: Span, file: File): Promise<void> {
    const span = StandardTracer.startSpan("FileData_add", context);
    await SqlDbutils.execSQL(
      span,
      "UPDATE files " +
        " SET idCloud = ?, accountId = ?, filename = ?, folderpath = ?, hash = ?, dateUpdated = ?, dateSync = ?, dateMedia = ?, info = ?, metadata = ? " +
        " WHERE id = ? ",
      [
        file.idCloud,
        file.accountId,
        file.filename,
        file.folderpath,
        file.hash,
        file.dateUpdated,
        file.dateSync,
        file.dateMedia,
        JSON.stringify(file.info),
        JSON.stringify(file.metadata),
        file.id,
      ]
    );
    span.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(fileRaw: any): File {
  const file = new File();
  file.id = fileRaw.id;
  file.idCloud = fileRaw.idCloud;
  file.accountId = fileRaw.accountId;
  file.filename = fileRaw.filename;
  file.folderpath = fileRaw.folderpath;
  file.dateSync = new Date(fileRaw.dateSync);
  file.dateUpdated = new Date(fileRaw.dateUpdated);
  file.dateMedia = new Date(fileRaw.dateMedia) || null;
  file.info = JSON.parse(fileRaw.info);
  file.metadata = JSON.parse(fileRaw.metadata);
  return file;
}
