import { Span } from "@opentelemetry/sdk-trace";
import { File } from "../model/File";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";

// Caps keeping a single duplicate group from loading an entire account at
// once. The listing itself is paginated by group (see below).
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

// Trashed files are excluded from duplicate analysis so badge counts and
// duplicate listings ignore copies that await restore or purge.
const TRASHED_CONDITION = " AND COALESCE(trashed, 0) = 0 ";

// Persisted "keep both / not duplicates" groups are excluded from listings,
// single-file lookups and counts; the subquery keeps the account scoped.
const IGNORED_CONDITION =
  " AND hash NOT IN (SELECT hash FROM duplicate_ignores WHERE accountId = ?) ";

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
      TRASHED_CONDITION +
      IGNORED_CONDITION +
      " AND hash IN " +
      " (SELECT hash FROM files WHERE id = ? AND accountId = ? AND hash IS NOT NULL AND hash != '' " +
      innerFilter.sql +
      TRASHED_CONDITION +
      ") ORDER BY hash, id LIMIT ? ",
    [
      accountId,
      ...outerFilter.params,
      accountId,
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
        TRASHED_CONDITION +
        IGNORED_CONDITION +
        " GROUP BY hash",
      [accountId, ...hashes, ...innerFilter.params, accountId],
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

// Lists duplicate groups page by page. Groups are ordered by hash (stable
// across pages) and every copy of a page's groups is returned. `total` is the
// number of duplicate groups in scope so the client can show "N of M".
export async function AnalysisDataListAccountDuplicates(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null,
  page: number,
  pageSize: number,
): Promise<{ duplicates: AnalysisDuplicate[]; total: number }> {
  const span = OTelTracer().startSpan(
    "AnalysisData_listAccountDuplicates",
    context,
  );
  const outerFilter = folderScopeFilter(permittedFolderIds);
  const innerFilter = folderScopeFilter(permittedFolderIds);
  const groupSelect =
    "SELECT hash FROM files WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
    innerFilter.sql +
    TRASHED_CONDITION +
    IGNORED_CONDITION +
    " GROUP BY hash HAVING count(*) > 1 ";
  const totalRows = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) AS count FROM (" + groupSelect + ")",
    [accountId, ...innerFilter.params, accountId],
  );
  const total = Number(totalRows[0]?.count ?? 0);
  // A page large enough to overflow the multiplication can never be reached:
  // clamp so the bound value stays an integer.
  const offset = Math.min(page * pageSize, Number.MAX_SAFE_INTEGER);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * " +
      " FROM files " +
      " WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      outerFilter.sql +
      TRASHED_CONDITION +
      " AND hash IN " +
      " (" +
      groupSelect +
      " ORDER BY hash LIMIT ? OFFSET ?) " +
      " ORDER BY hash, id ",
    [
      accountId,
      ...outerFilter.params,
      accountId,
      ...innerFilter.params,
      accountId,
      pageSize,
      offset,
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
  return { duplicates: analysis, total };
}

// Server-side snapshot of the groups being ignored: the client-supplied counts
// and paths are never trusted, only hashes that currently form a group for the
// account are persisted.
export async function AnalysisDataGetDuplicateGroupSummaries(
  context: Span,
  accountId: string,
  hashes: string[],
): Promise<
  Record<string, { fileCount: number; filename: string; folderId: string }>
> {
  const span = OTelTracer().startSpan(
    "AnalysisData_getDuplicateGroupSummaries",
    context,
  );
  const result: Record<
    string,
    { fileCount: number; filename: string; folderId: string }
  > = {};
  if (!hashes || hashes.length === 0) {
    span.end();
    return result;
  }
  const placeholders = hashes.map(() => "?").join(", ");
  const rows = await SqlDbUtilsQuerySQL(
    span,
    "SELECT hash, COUNT(*) AS count, MIN(filename) AS filename, MIN(folderId) AS folderId " +
      " FROM files " +
      " WHERE accountId = ? AND hash IN (" +
      placeholders +
      ") AND hash IS NOT NULL AND hash != '' " +
      TRASHED_CONDITION +
      " GROUP BY hash ",
    [accountId, ...hashes],
  );
  for (const row of rows) {
    const fileCount = Number(row.count);
    if (fileCount > 1) {
      result[row.hash] = {
        fileCount,
        filename: row.filename,
        folderId: row.folderId,
      };
    }
  }
  span.end();
  return result;
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
