import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { File } from "../model/File";

export class FileData {
  //
  public static async getByPath(context: Span, accountId: string, filepath: string): Promise<File> {
    const span = StandardTracer.startSpan("FileData_getByPath", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM files WHERE accountId = ? AND filepath = ? ", [
      accountId,
      filepath,
    ]);
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

  public static async add(context: Span, file: File): Promise<void> {
    const span = StandardTracer.startSpan("FileData_add", context);
    await SqlDbutils.execSQL(span, "INSERT INTO files (id, accountId, filepath, name, info) VALUES (?, ?, ?, ?, ?) ", [
      file.id,
      file.accountId,
      file.filepath,
      file.name,
      JSON.stringify(file.info),
    ]);
    span.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(fileRaw: any): File {
  const file = new File();
  file.id = fileRaw.id;
  file.name = fileRaw.name;
  file.accountId = fileRaw.accountId;
  file.filepath = fileRaw.filepath;
  file.info = JSON.parse(fileRaw.info);
  return file;
}
