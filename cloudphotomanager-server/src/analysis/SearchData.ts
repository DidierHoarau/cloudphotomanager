import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { File } from "../model/File";
import { AnalysisDuplicate } from "../model/AnalysisDuplicate";
import {
  FILE_MEDIA_TYPE_EXTENSIONS,
  FileMediaType,
} from "../model/FileMediaType";
import { FolderDataGet, FolderDataListForAccount } from "../folders/FolderData";
import { OTelTracer } from "../OTelContext";
import { SqlEscapeLike } from "../utils-std-ts/SqlLike";
import {
  buildGeoBoxConditionSql,
  GeoBox,
  GEO_LAT_EXPR,
  GEO_LON_EXPR,
  GEO_PRESENT_CONDITION,
  isValidGeoBox,
} from "./SearchGeoSql";

// Upper bound on rows returned by a single search query; keeps an unfiltered
// search from loading an entire account into memory.
export const SEARCH_MAX_RESULTS = 5000;
// Duplicate listing caps: number of duplicate groups (distinct hashes) and
// total rows returned.
export const DUPLICATES_MAX_GROUPS = 500;
export const DUPLICATES_MAX_ROWS = 10000;
// Maximum number of distinct labels returned by the label listing.
export const SEARCH_LABELS_MAX = 200;

export async function SearchDataListAccountDuplicates(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null = null,
): Promise<AnalysisDuplicate[]> {
  const span = OTelTracer().startSpan(
    "SearchDataListAccountDuplicates",
    context,
  );
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const trashedCondition = " AND COALESCE(trashed, 0) = 0 ";
  const params: any[] = [accountId];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  params.push(accountId);
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  params.push(DUPLICATES_MAX_GROUPS, DUPLICATES_MAX_ROWS);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * " +
      " FROM files " +
      " WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      folderFilterSql +
      trashedCondition +
      " AND hash IN " +
      " ( SELECT hash FROM files WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      folderFilterSql +
      trashedCondition +
      " GROUP BY hash HAVING count(*) > 1 ORDER BY hash LIMIT ?) " +
      " ORDER BY hash, id LIMIT ? ",
    params,
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
      _.find(knownFolders, { id: file.folderId }),
    );
  }
  span.end();
  return analysis;
}

export async function SearchDataListFiles(
  context: Span,
  accountId: string,
  filters: any,
  permittedFolderIds: string[] | null = null,
): Promise<File[]> {
  const span = OTelTracer().startSpan("SearchDataListFiles", context);
  let queryCondition = " AND COALESCE(trashed, 0) = 0 ";
  const queryParameters = [accountId];
  if (permittedFolderIds !== null) {
    queryCondition += " AND folderId IN (SELECT value FROM json_each(?)) ";
    queryParameters.push(JSON.stringify(permittedFolderIds));
  }
  if (filters.favoriteOnly === true) {
    queryCondition += " AND COALESCE(favorite, 0) = 1 ";
  }
  if (filters.outtakesOnly === true) {
    queryCondition += " AND filename LIKE '%-outtake.%' ";
  }
  if (filters.hasLocation === true) {
    queryCondition += ` AND ${GEO_PRESENT_CONDITION} `;
  }
  // Media-type facet: match the filename extension against the shared
  // extension lists (same source of truth as File.getMediaType). Unknown
  // values are ignored; the unknown type itself is not offered as a facet.
  // A selection with no known media type matches nothing.
  if (Array.isArray(filters.mediaTypes) && filters.mediaTypes.length > 0) {
    const extensions: string[] = [];
    for (const mediaType of filters.mediaTypes) {
      if (
        mediaType === FileMediaType.image ||
        mediaType === FileMediaType.video ||
        mediaType === FileMediaType.imageRaw
      ) {
        extensions.push(...FILE_MEDIA_TYPE_EXTENSIONS[mediaType]);
      }
    }
    if (extensions.length === 0) {
      span.end();
      return [];
    }
    const likeConditions = extensions
      .map(() => "LOWER(filename) LIKE ? ")
      .join(" OR ");
    queryCondition += ` AND (${likeConditions}) `;
    for (const extension of extensions) {
      queryParameters.push(`%.${extension}`);
    }
  }
  // Folder facet: restrict to the folder subtree (the folder itself plus its
  // children). A folder outside the caller's permissions or an unknown folder
  // yields no results.
  if (filters.folderId) {
    const folder = await FolderDataGet(span, filters.folderId);
    const permitted =
      folder &&
      folder.accountId === accountId &&
      (permittedFolderIds === null ||
        permittedFolderIds.includes(folder.id));
    if (!permitted) {
      span.end();
      return [];
    }
    const subtreePrefix =
      folder.folderpath === "/" ? "/" : `${folder.folderpath}/`;
    const folderpathSubPattern = `${SqlEscapeLike(subtreePrefix)}%`;
    queryCondition +=
      " AND folderId IN (SELECT id FROM folders WHERE accountId = ? " +
      " AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\')) ";
    queryParameters.push(accountId, folder.folderpath, folderpathSubPattern);
  }
  if (filters.dateFrom) {
    queryCondition += " AND dateMedia > ? ";
    queryParameters.push(new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    queryCondition += " AND dateMedia < ? ";
    queryParameters.push(new Date(filters.dateTo).toISOString());
  }
  if (filters.keywords) {
    for (const keyword of filters.keywords.split(" ")) {
      if (keyword.trim()) {
        queryCondition += " AND keywords like ? ";
        queryParameters.push(`%${keyword.trim()}%`);
      }
    }
  }
  if (isValidGeoBox(filters.geoBox)) {
    const geo = buildGeoBoxConditionSql(filters.geoBox);
    queryCondition += geo.sql;
    queryParameters.push(...geo.params);
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? " +
      queryCondition +
      " ORDER BY dateMedia DESC, id DESC LIMIT ? ",
    [...queryParameters, SEARCH_MAX_RESULTS],
  );
  const files: File[] = [];
  for (const fileRaw of rawData) {
    files.push(fromRaw(fileRaw));
  }
  span.end();
  return files;
}

export interface SearchLabel {
  label: string;
  count: number;
}

// Browses the classification labels already stored in the files.keywords
// column ("lowercase(filename) + space-separated labels"). The filename
// tokens are excluded so only real classification labels are listed.
export async function SearchDataListAccountLabels(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null = null,
): Promise<SearchLabel[]> {
  const span = OTelTracer().startSpan("SearchDataListAccountLabels", context);
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const params: any[] = [accountId];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT filename, keywords FROM files " +
      " WHERE accountId = ? AND COALESCE(trashed, 0) = 0 " +
      folderFilterSql +
      " AND keywords IS NOT NULL AND keywords != '' ",
    params,
  );
  const labelCounts = new Map<string, number>();
  for (const row of rawData) {
    const filenameTokens = new Set(
      String(row.filename).toLowerCase().split(/\s+/).filter(Boolean),
    );
    const tokens = String(row.keywords)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const fileLabels = new Set<string>();
    for (const token of tokens) {
      if (token.length < 3 || /^\d+$/.test(token)) {
        continue;
      }
      if (filenameTokens.has(token)) {
        continue;
      }
      fileLabels.add(token);
    }
    for (const label of fileLabels) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  const labels: SearchLabel[] = [...labelCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, SEARCH_LABELS_MAX);
  span.end();
  return labels;
}

export interface GeoGridCell {
  row: number;
  col: number;
  count: number;
  centerLat: number;
  centerLon: number;
}

export interface GeoGridResult {
  bbox: GeoBox;
  gridRows: number;
  gridCols: number;
  cells: GeoGridCell[];
}

export async function SearchDataAggregateByGeoGrid(
  context: Span,
  accountId: string,
  options: {
    bbox: GeoBox;
    gridRows?: number;
    gridCols?: number;
    filters?: any;
  },
  permittedFolderIds: string[] | null = null,
): Promise<GeoGridResult> {
  const span = OTelTracer().startSpan("SearchDataAggregateByGeoGrid", context);
  const gridRows =
    options.gridRows && options.gridRows > 0 ? options.gridRows : 10;
  const gridCols =
    options.gridCols && options.gridCols > 0 ? options.gridCols : 10;
  const bbox = options.bbox;
  const latSpan = bbox.maxLat - bbox.minLat;
  const lonSpan = bbox.maxLon - bbox.minLon;
  // Guard against degenerate bboxes (zero-width / inverted).
  if (latSpan <= 0 || lonSpan <= 0) {
    span.end();
    return { bbox, gridRows, gridCols, cells: [] };
  }
  const cellHeight = latSpan / gridRows;
  const cellWidth = lonSpan / gridCols;

  const queryParameters: any[] = [accountId];
  let extraCondition = " AND COALESCE(trashed, 0) = 0 ";
  if (permittedFolderIds !== null) {
    extraCondition += " AND folderId IN (SELECT value FROM json_each(?)) ";
    queryParameters.push(JSON.stringify(permittedFolderIds));
  }
  const filters = options.filters || {};
  if (filters.dateFrom) {
    extraCondition += " AND dateMedia > ? ";
    queryParameters.push(new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    extraCondition += " AND dateMedia < ? ";
    queryParameters.push(new Date(filters.dateTo).toISOString());
  }
  if (filters.keywords) {
    for (const keyword of filters.keywords.split(" ")) {
      if (keyword.trim()) {
        extraCondition += " AND keywords like ? ";
        queryParameters.push(`%${keyword.trim()}%`);
      }
    }
  }

  // Restrict to files with GPS data inside the bbox.
  const geo = buildGeoBoxConditionSql(bbox);
  extraCondition += geo.sql;
  queryParameters.push(...geo.params);

  // Bucket index = floor((value - min) / cellSize), clamped to [0, count-1]
  // so points exactly on the maxLat / maxLon edge fall into the last cell.
  const rowExpr = ` MIN(? - 1, MAX(0, CAST((${GEO_LAT_EXPR} - ?) / ? AS INTEGER))) `;
  const colExpr = ` MIN(? - 1, MAX(0, CAST((${GEO_LON_EXPR} - ?) / ? AS INTEGER))) `;

  // Prepend the bucket-math params for the SELECT clause; GROUP BY uses
  // the row/col aliases so we don't repeat the bucket expression.
  const bucketParams: any[] = [
    gridRows,
    bbox.minLat,
    cellHeight,
    gridCols,
    bbox.minLon,
    cellWidth,
  ];

  const sql =
    `SELECT ${rowExpr} AS row, ${colExpr} AS col, ` +
    `       COUNT(*) AS count, ` +
    `       AVG(${GEO_LAT_EXPR}) AS centerLat, ` +
    `       AVG(${GEO_LON_EXPR}) AS centerLon ` +
    ` FROM files ` +
    ` WHERE accountId = ? AND ${GEO_PRESENT_CONDITION} ${extraCondition} ` +
    ` GROUP BY row, col `;

  const params: any[] = [...bucketParams, ...queryParameters];
  const rawData = await SqlDbUtilsQuerySQL(span, sql, params);
  const cells: GeoGridCell[] = rawData.map((r: any) => ({
    row: Number(r.row),
    col: Number(r.col),
    count: Number(r.count),
    centerLat: Number(r.centerLat),
    centerLon: Number(r.centerLon),
  }));
  span.end();
  return { bbox, gridRows, gridCols, cells };
}

// Private Function

function fromRaw(fileRaw: any): File {
  const file = new File(fileRaw.accountId, fileRaw.folderId, fileRaw.filename);
  file.id = fileRaw.id;
  file.idCloud = fileRaw.idCloud;
  file.hash = fileRaw.hash;
  file.favorite = fileRaw.favorite ?? 0;
  file.dateSync = new Date(fileRaw.dateSync);
  file.dateUpdated = new Date(fileRaw.dateUpdated);
  file.dateMedia = new Date(fileRaw.dateMedia);
  file.info = JSON.parse(fileRaw.info);
  file.metadata = JSON.parse(fileRaw.metadata);
  return file;
}
