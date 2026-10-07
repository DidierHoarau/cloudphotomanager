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
  const placeholders = fileIds.map(() => "?").join(", ");
  // Two index-only lookups instead of aggregating the whole account:
  // fetch the requested files by the unique id index, then count each
  // involved hash once via files(accountId, hash). The first step must NOT
  // carry the accountId predicate — with `accountId = ? AND id IN (...)`
  // the planner range-scans the 80k+ account index instead of probing the
  // few ids. Ids are globally unique, so the account check happens in JS.
  const requested = await SqlDbUtilsQuerySQL(
    span,
    `SELECT id, accountId, hash, folderId FROM files WHERE id IN (${placeholders})`,
    [...fileIds],
  );
  const requestedRows = requested.filter(
    (row) =>
      row.accountId === accountId &&
      row.hash !== null &&
      row.hash !== undefined &&
      row.hash !== "" &&
      (permittedFolderIds === null ||
        permittedFolderIds.includes(row.folderId)),
  );
  const hashes = [...new Set(requestedRows.map((row) => row.hash))];
  let countByHash = new Map<string, number>();
  if (hashes.length > 0) {
    const innerFilter = folderScopeFilter(permittedFolderIds);
    const hashPlaceholders = hashes.map(() => "?").join(", ");
    const counted = await SqlDbUtilsQuerySQL(
      span,
      "SELECT hash, COUNT(*) AS count FROM files " +
        " WHERE accountId = ? " +
        "   AND hash IN (" +
        hashPlaceholders +
        ") " +
        innerFilter.sql +
        " GROUP BY hash",
      [accountId, ...hashes, ...innerFilter.params],
    );
    countByHash = new Map(
      counted.map((row) => [row.hash, Number(row.count)]),
    );
  }
  for (const row of requestedRows) {
    const count = countByHash.get(row.hash);
    if (count !== undefined && count >= 2) {
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
