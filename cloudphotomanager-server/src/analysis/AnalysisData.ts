import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { File } from "../model/File";
import { Config } from "../Config";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import { Folder } from "../model/Folder";
import { FolderData } from "../folders/FolderData";

let config: Config;

export class AnalysisData {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("AnalysisData_init", context);
    config = configIn;
    span.end();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static async listAccountDuplicates(context: Span, accountId: string): Promise<AnalysisDuplicate[]> {
    const span = StandardTracer.startSpan("AnalysisData_listAccountDuplicates", context);
    const rawData = await SqlDbutils.querySQL(
      span,
      "SELECT * " +
        " FROM files " +
        " WHERE hash IN " +
        " ( SELECT hash FROM files GROUP BY hash HAVING count(*) > 1 ) " +
        " ORDER BY hash ",
      []
    );
    const analysis: AnalysisDuplicate[] = [];
    let currentAnalysisDuplicate: AnalysisDuplicate = null;
    for (const fileRaw of rawData) {
      const file = fromRaw(fileRaw);
      if (!currentAnalysisDuplicate || currentAnalysisDuplicate.hash !== file.hash) {
        currentAnalysisDuplicate = {
          accountId: file.accountId,
          hash: file.hash,
          files: [],
          folders: [],
        };
        analysis.push(currentAnalysisDuplicate);
      }
      currentAnalysisDuplicate.files.push(file);
      currentAnalysisDuplicate.folders.push(await FolderData.get(span, file.accountId, file.folderId));
    }
    span.end();
    return analysis;
  }
}

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
