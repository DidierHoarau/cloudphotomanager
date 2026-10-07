import { Span } from "@opentelemetry/sdk-trace-base";
import { File } from "../model/File";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";

// Caps keeping a duplicate analysis from loading an entire account at once.
const DUPLICATES_MAX_GROUPS = 500;
const DUPLICATES_MAX_ROWS = 10000;

// When permittedFolderIds is non-null, adds a folder scope filter; the ids
// are passed as a JSON array through SQLite's json_each so the number of
// permitted folders is not limited by SQL parameter counts.
function folderScopeFilter(permittedFolderIds: string[] | null): {
  sql: string;
  params: any[];
} {
  if (permittedFolderIds === null) {
    return { sql: "", params: [] };
  }
  return {
    sql: " AND folderId IN (SELECT value FROM json_each(?)) ",
    params: [JSON.stringify(permittedFolderIds)],
  };
}

export async function AnalysisDataGetFileDuplicates(
  context: Span,
  accountId: string,
  fileId: string,
  permittedFolderIds: string[] | null = null,
): Promise<AnalysisDuplicate | null> {
  const span = OTelTracer().startSpan(
    "AnalysisData_getFileDuplicates",
    context,
  );
  const outerFilter = folderScopeFilter(permittedFolderIds);
  const innerFilter = folderScopeFilter(permittedFolderIds);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      outerFilter.sql +
      " AND hash IN " +
      " (SELECT hash FROM files WHERE id = ? AND accountId = ? AND hash IS NOT NULL AND hash != '' " +
      innerFilter.sql +
      ") ORDER BY hash, id LIMIT ? ",
    [
      accountId,
      ...outerFilter.params,
      fileId,
      accountId,
      ...innerFilter.params,
      DUPLICATES_MAX_ROWS,
    ],
  );
  span.end();
  if (rawData.length < 2) {
    return null;
  }
  const result: AnalysisDuplicate = {
    accountId,
    hash: rawData[0].hash,
    files: rawData.map(fromRaw),
    folders: [],
  };
  return result;
}

export async function AnalysisDataGetFilesDuplicateCounts(
  context: Span,
  accountId: string,
  fileIds: string[],
  permittedFolderIds: string[] | null = null,
): Promise<Record<string, number>> {
  const span = OTelTracer().startSpan(
    "AnalysisData_getFilesDuplicateCounts",
    context,
  );
  const result: Record<string, number> = {};
  if (!fileIds || fileIds.length === 0) {
    span.end();
    return result;
  }
  const innerFilter = folderScopeFilter(permittedFolderIds);
  const outerFilter = folderScopeFilter(permittedFolderIds);
  const placeholders = fileIds.map(() => "?").join(", ");
  // Single pass over the account: hash counts are computed once in a
  // GROUP BY derived table (served index-only by files(accountId, hash))
  // instead of one correlated COUNT per requested id.
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT f.id AS id, " +
      "       counts.count AS count " +
      "  FROM files f " +
      "  JOIN (SELECT hash, COUNT(*) AS count " +
      "          FROM files " +
      "         WHERE accountId = ? " +
      "           AND hash IS NOT NULL " +
      "           AND hash != '' " +
      innerFilter.sql +
      "         GROUP BY hash) counts " +
      "    ON counts.hash = f.hash " +
      " WHERE f.accountId = ? " +
      "   AND f.hash IS NOT NULL " +
      "   AND f.hash != '' " +
      outerFilter.sql +
      `   AND f.id IN (${placeholders})`,
    [
      accountId,
      ...innerFilter.params,
      accountId,
      ...outerFilter.params,
      ...fileIds,
    ],
  );
  for (const row of rawData) {
    const count = Number(row.count);
    if (count >= 2) {
      result[row.id] = count;
    }
  }
  span.end();
  return result;
}

export async function AnalysisDataListAccountDuplicates(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null = null,
): Promise<AnalysisDuplicate[]> {
  const span = OTelTracer().startSpan(
    "AnalysisData_listAccountDuplicates",
    context,
  );
  const outerFilter = folderScopeFilter(permittedFolderIds);
  const innerFilter = folderScopeFilter(permittedFolderIds);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * " +
      " FROM files " +
      " WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      outerFilter.sql +
      " AND hash IN " +
      " ( SELECT hash FROM files WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      innerFilter.sql +
      " GROUP BY hash HAVING count(*) > 1 ORDER BY hash LIMIT ?) " +
      " ORDER BY hash, id LIMIT ? ",
    [
      accountId,
      ...outerFilter.params,
      accountId,
      ...innerFilter.params,
      DUPLICATES_MAX_GROUPS,
      DUPLICATES_MAX_ROWS,
    ],
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
