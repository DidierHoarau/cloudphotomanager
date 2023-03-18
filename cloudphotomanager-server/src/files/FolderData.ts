import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { Config } from "../Config";
import { Folder } from "../model/Folder";

let config: Config;

export class FolderData {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("FolderData_init", context);
    config = configIn;
    span.end();
  }

  public static async listForAccount(context: Span, accountId: string): Promise<Folder[]> {
    const span = StandardTracer.startSpan("FolderData_listForAccount", context);
    const rawData = await SqlDbutils.querySQL(
      span,
      "SELECT COUNT(*) as childrenCount, folderpath FROM files WHERE accountId = ? GROUP BY folderpath",
      [accountId]
    );
    const folders = [];
    rawData.forEach((folderRaw) => {
      const folder = new Folder();
      folder.accountId = accountId;
      folder.childrenCount = folderRaw.childrenCount;
      folder.folderpath = folderRaw.folderpath;
      folders.push(folder);
    });
    span.end();
    return folders;
  }

  public static async deleteForAccount(context: Span, accountId: string, folderpath: string): Promise<void> {
    const span = StandardTracer.startSpan("FolderData_listForAccount", context);
    await SqlDbutils.execSQL(span, "DELETE FROM files WHERE accountId = ? AND folderpath = ?", [accountId, folderpath]);
    span.end();
  }
}
