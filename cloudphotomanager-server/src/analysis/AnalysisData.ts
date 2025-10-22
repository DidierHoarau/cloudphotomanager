import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { File } from "../model/File";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import { FolderDataListForAccount } from "../folders/FolderData";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";
import { OTelTracer } from "../OTelContext";

export async function AnalysisDataListAccountDuplicates(
  context: Span,
  accountId: string
): Promise<AnalysisDuplicate[]> {
  const span = OTelTracer().startSpan(
    "AnalysisData_listAccountDuplicates",
    context
  );
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * " +
      " FROM files " +
      " WHERE accountId = ? AND hash IN " +
      " ( SELECT hash FROM files WHERE accountId = ? GROUP BY hash HAVING count(*) > 1) " +
      " ORDER BY hash ",
    [accountId, accountId]
  );
  const analysis: AnalysisDuplicate[] = [];
  let currentAnalysisDuplicate: AnalysisDuplicate = null;
  for (const fileRaw of rawData) {
    const file = fromRaw(fileRaw);
    if (
      !currentAnalysisDuplicate ||
      currentAnalysisDuplicate.hash !== file.hash
    ) {
      currentAnalysisDuplicate = {
        accountId: file.accountId,
        hash: file.hash,
        files: [],
        folders: [],
      };
      analysis.push(currentAnalysisDuplicate);
    }
    currentAnalysisDuplicate.files.push(file);
  }
  span.end();
  return analysis;
}

// Private Function

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
