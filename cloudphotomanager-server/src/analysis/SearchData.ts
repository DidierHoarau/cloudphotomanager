import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { File } from "../model/File";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import { FolderDataListForAccount } from "../folders/FolderData";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function SearchDataListAccountDuplicates(
  context: Span,
  accountId: string
): Promise<AnalysisDuplicate[]> {
  const span = StandardTracerStartSpan(
    "SearchDataListAccountDuplicates",
    context
  );
  const rawData = await SqlDbutils.querySQL(
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
  const knownFolders = await FolderDataListForAccount(span, accountId);
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
    currentAnalysisDuplicate.folders.push(
      _.find(knownFolders, { id: file.folderId })
    );
  }
  span.end();
  return analysis;
}

export async function SearchDataListFiles(
  context: Span,
  accountId: string,
  filters: any
): Promise<File[]> {
  const span = StandardTracerStartSpan("SearchDataListFiles", context);
  let queryCondition = "";
  const queryParameters = [accountId];
  if (filters.dateFrom) {
    queryCondition += " AND dateMedia > ? ";
    queryParameters.push(new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    queryCondition += " AND dateMedia < ? ";
    queryParameters.push(new Date(filters.dateTo).toISOString());
  }
  if (filters.keywords) {
    for (let keyword of filters.keywords.split(" ")) {
      if (keyword.trim()) {
        queryCondition += " AND keywords like ? ";
        queryParameters.push(`%${keyword.trim()}%`);
      }
    }
  }
  const rawData = await SqlDbutils.querySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? " + queryCondition,
    queryParameters
  );
  const files: File[] = [];
  for (const fileRaw of rawData) {
    files.push(fromRaw(fileRaw));
  }
  span.end();
  return files;
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
