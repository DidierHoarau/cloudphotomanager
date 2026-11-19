import { Span } from "@opentelemetry/sdk-trace";
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
import { PlaceLabel } from "../geo/PlaceGeocoder";
import {
  buildGeoBoxConditionSql,
  GeoBox,
  GEO_LAT_EXPR,
  GEO_LON_EXPR,
  GEO_PRESENT_CONDITION,
  isValidGeoBox,
} from "./SearchGeoSql";

// Upper bound on rows returned by a single search request; clients browse
// beyond it with `offset` pagination (the response says how many match).
export const SEARCH_MAX_RESULTS = 5000;
// Duplicate listing caps: number of duplicate groups (distinct hashes) and
// total rows returned.
export const DUPLICATES_MAX_GROUPS = 500;
export const DUPLICATES_MAX_ROWS = 10000;
// Maximum number of distinct labels / places returned by the listings.
export const SEARCH_LABELS_MAX = 500;
export const SEARCH_PLACES_MAX = 500;

export interface SearchSortOption {
  key: string;
  clause: string;
}

// Whitelisted sort orders. Every clause ends with the id tiebreaker so the
// order is deterministic for equal keys.
const SEARCH_SORT_CLAUSES: Record<string, string> = {
  date_desc: "(dateMedia IS NULL) ASC, dateMedia DESC, id DESC",
  date_asc: "(dateMedia IS NULL) ASC, dateMedia ASC, id ASC",
  filename_asc: "LOWER(filename) ASC, id ASC",
  filename_desc: "LOWER(filename) DESC, id DESC",
  size_asc:
    "(CAST(json_extract(info, '$.size') AS INTEGER) IS NULL) ASC, " +
    "CAST(json_extract(info, '$.size') AS INTEGER) ASC, id ASC",
  size_desc:
    "(CAST(json_extract(info, '$.size') AS INTEGER) IS NULL) ASC, " +
    "CAST(json_extract(info, '$.size') AS INTEGER) DESC, id DESC",
};

export const SEARCH_SORT_KEYS = Object.keys(SEARCH_SORT_CLAUSES);

export function SearchSortNormalize(sort: any): string {
  return typeof sort === "string" && SEARCH_SORT_CLAUSES[sort]
    ? sort
    : "date_desc";
}

export function SearchSortClause(sort: any): string {
  return SEARCH_SORT_CLAUSES[SearchSortNormalize(sort)];
}

export interface SearchOptions {
  sort?: string;
  limit?: number;
  offset?: number;
}

function clampLimit(limit: any): number {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) {
    return SEARCH_MAX_RESULTS;
  }
  return Math.min(Math.floor(value), SEARCH_MAX_RESULTS);
}

function clampOffset(offset: any): number {
  const value = Number(offset);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export function SearchLimitClamp(limit: any): number {
  return clampLimit(limit);
}

export function SearchOffsetClamp(offset: any): number {
  return clampOffset(offset);
}

interface SearchConditions {
  sql: string;
  params: any[];
  // Set when the filter selection can never match (unknown media types,
  // folder outside the caller's permissions): short-circuit to no results.
  forceEmpty: boolean;
}

function filterDateIso(value: any): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

// Shared WHERE fragment for search, counts and the geo grid. The caller adds
// `accountId = ?` first; every returned parameter follows that order.
async function BuildSearchConditions(
  context: Span,
  accountId: string,
  filtersIn: any,
  permittedFolderIds: string[] | null,
): Promise<SearchConditions> {
  const filters = filtersIn || {};
  let sql = " AND COALESCE(trashed, 0) = 0 ";
  const params: any[] = [];
  let forceEmpty = false;

  if (permittedFolderIds !== null) {
    sql += " AND folderId IN (SELECT value FROM json_each(?)) ";
    params.push(JSON.stringify(permittedFolderIds));
  }
  if (filters.favoriteOnly === true) {
    sql += " AND COALESCE(favorite, 0) = 1 ";
  }
  if (filters.outtakesOnly === true) {
    sql += " AND filename LIKE '%-outtake.%' ";
  }
  if (filters.hasLocation === true) {
    sql += ` AND ${GEO_PRESENT_CONDITION} `;
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
      forceEmpty = true;
    } else {
      const likeConditions = extensions
        .map(() => "LOWER(filename) LIKE ? ")
        .join(" OR ");
      sql += ` AND (${likeConditions}) `;
      for (const extension of extensions) {
        params.push(`%.${extension}`);
      }
    }
  }
  // Folder facet: restrict to the folder subtree (the folder itself plus its
  // children). A folder outside the caller's permissions or an unknown folder
  // yields no results.
  if (filters.folderId) {
    const folder = await FolderDataGet(context, filters.folderId);
    const permitted =
      folder &&
      folder.accountId === accountId &&
      (permittedFolderIds === null ||
        permittedFolderIds.includes(folder.id));
    if (!permitted) {
      forceEmpty = true;
    } else {
      const subtreePrefix =
        folder.folderpath === "/" ? "/" : `${folder.folderpath}/`;
      const folderpathSubPattern = `${SqlEscapeLike(subtreePrefix)}%`;
      sql +=
        " AND folderId IN (SELECT id FROM folders WHERE accountId = ? " +
        " AND (folderpath = ? OR folderpath LIKE ? ESCAPE '\\')) ";
      params.push(accountId, folder.folderpath, folderpathSubPattern);
    }
  }
  // Inclusive date range: a same-day from/to returns that day's files when
  // the client sends local start-of-day / end-of-day (23:59:59.999).
  const dateFrom = filterDateIso(filters.dateFrom);
  if (dateFrom) {
    sql += " AND dateMedia >= ? ";
    params.push(dateFrom);
  }
  const dateTo = filterDateIso(filters.dateTo);
  if (dateTo) {
    sql += " AND dateMedia <= ? ";
    params.push(dateTo);
  }
  // Free-text tokens match the keywords (filename + classification labels)
  // and the place columns, so "Brittany 2024" also finds place names.
  if (filters.keywords) {
    for (const keyword of String(filters.keywords).split(" ")) {
      const token = keyword.trim();
      if (token) {
        sql +=
          " AND (keywords LIKE ? OR placeCity LIKE ? OR placeRegion LIKE ? " +
          " OR placeCountry LIKE ? OR placeCountryCode LIKE ?) ";
        params.push(
          `%${token}%`,
          `%${token}%`,
          `%${token}%`,
          `%${token}%`,
          `%${token}%`,
        );
      }
    }
  }
  // Exact place facet from the server-provided place list.
  if (filters.placeCountry) {
    sql += " AND placeCountry = ? ";
    params.push(filters.placeCountry);
  }
  if (filters.placeRegion) {
    sql += " AND placeRegion = ? ";
    params.push(filters.placeRegion);
  }
  if (filters.placeCity) {
    sql += " AND placeCity = ? ";
    params.push(filters.placeCity);
  }
  if (isValidGeoBox(filters.geoBox)) {
    const geo = buildGeoBoxConditionSql(filters.geoBox);
    sql += geo.sql;
    params.push(...geo.params);
  }
  return { sql, params, forceEmpty };
}

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
  options: SearchOptions = {},
): Promise<File[]> {
  const span = OTelTracer().startSpan("SearchDataListFiles", context);
  const conditions = await BuildSearchConditions(
    span,
    accountId,
    filters,
    permittedFolderIds,
  );
  if (conditions.forceEmpty) {
    span.end();
    return [];
  }
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? " +
      conditions.sql +
      " ORDER BY " +
      SearchSortClause(options.sort) +
      " LIMIT ? OFFSET ? ",
    [accountId, ...conditions.params, limit, offset],
  );
  const files: File[] = [];
  for (const fileRaw of rawData) {
    files.push(fromRaw(fileRaw));
  }
  span.end();
  return files;
}

export async function SearchDataCountFiles(
  context: Span,
  accountId: string,
  filters: any,
  permittedFolderIds: string[] | null = null,
): Promise<number> {
  const span = OTelTracer().startSpan("SearchDataCountFiles", context);
  const conditions = await BuildSearchConditions(
    span,
    accountId,
    filters,
    permittedFolderIds,
  );
  if (conditions.forceEmpty) {
    span.end();
    return 0;
  }
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) AS count FROM files WHERE accountId = ? " +
      conditions.sql,
    [accountId, ...conditions.params],
  );
  span.end();
  return Number(rawData[0]?.count ?? 0);
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

export interface SearchPlace {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  label: string;
  count: number;
}

// Distinct places already resolved on the account's files, with counts, for
// the search place filter.
export async function SearchDataListAccountPlaces(
  context: Span,
  accountId: string,
  permittedFolderIds: string[] | null = null,
): Promise<SearchPlace[]> {
  const span = OTelTracer().startSpan("SearchDataListAccountPlaces", context);
  const folderFilterSql =
    permittedFolderIds === null
      ? ""
      : " AND folderId IN (SELECT value FROM json_each(?)) ";
  const params: any[] = [accountId];
  if (permittedFolderIds !== null) {
    params.push(JSON.stringify(permittedFolderIds));
  }
  params.push(SEARCH_PLACES_MAX);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT placeCountry AS country, placeCountryCode AS countryCode, " +
      " placeRegion AS region, placeCity AS city, COUNT(*) AS count " +
      " FROM files " +
      " WHERE accountId = ? AND COALESCE(trashed, 0) = 0 " +
      folderFilterSql +
      " AND placeStatus = 'ok' AND placeCity IS NOT NULL AND placeCity != '' " +
      " GROUP BY placeCountry, placeCountryCode, placeRegion, placeCity " +
      " ORDER BY count DESC, placeCountry, placeRegion, placeCity " +
      " LIMIT ? ",
    params,
  );
  const places: SearchPlace[] = rawData.map((row: any) => ({
    country: row.country ?? null,
    countryCode: row.countryCode ?? null,
    region: row.region ?? null,
    city: row.city ?? null,
    label: PlaceLabel({
      country: row.country,
      region: row.region,
      city: row.city,
    }),
    count: Number(row.count),
  }));
  span.end();
  return places;
}

export interface GeoGridCell {
  row: number;
  col: number;
  count: number;
  centerLat: number;
  centerLon: number;
  placeLabel: string | null;
  placeCountry: string | null;
  placeRegion: string | null;
  placeCity: string | null;
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

  const conditions = await BuildSearchConditions(
    span,
    accountId,
    options.filters || {},
    permittedFolderIds,
  );
  if (conditions.forceEmpty) {
    span.end();
    return { bbox, gridRows, gridCols, cells: [] };
  }
  let extraCondition = conditions.sql;

  // Restrict to files with GPS data inside the bbox.
  const geo = buildGeoBoxConditionSql(bbox);
  extraCondition += geo.sql;

  // Bucket index = floor((value - min) / cellSize), clamped to [0, count-1]
  // so points exactly on the maxLat / maxLon edge fall into the last cell.
  const rowExpr = ` MIN(? - 1, MAX(0, CAST((${GEO_LAT_EXPR} - ?) / ? AS INTEGER))) `;
  const colExpr = ` MIN(? - 1, MAX(0, CAST((${GEO_LON_EXPR} - ?) / ? AS INTEGER))) `;

  const bucketParams: any[] = [
    gridRows,
    bbox.minLat,
    cellHeight,
    gridCols,
    bbox.minLon,
    cellWidth,
  ];

  // One row per (cell, place): the JS side sums the counts and picks the
  // dominant place per cell for the accessible marker label.
  const sql =
    `SELECT ${rowExpr} AS row, ${colExpr} AS col, ` +
    `       placeCountry AS placeCountry, placeRegion AS placeRegion, ` +
    `       placeCity AS placeCity, COUNT(*) AS count, ` +
    `       AVG(${GEO_LAT_EXPR}) AS centerLat, ` +
    `       AVG(${GEO_LON_EXPR}) AS centerLon ` +
    ` FROM files ` +
    ` WHERE accountId = ? AND ${GEO_PRESENT_CONDITION} ${extraCondition} ` +
    ` GROUP BY row, col, placeCountry, placeRegion, placeCity `;

  const params: any[] = [
    ...bucketParams,
    accountId,
    ...conditions.params,
    ...geo.params,
  ];
  const rawData = await SqlDbUtilsQuerySQL(span, sql, params);

  interface CellPlaceCount {
    count: number;
    country: string | null;
    region: string | null;
    city: string | null;
  }
  const byCell = new Map<string, GeoGridCell & { _latSum: number; _lonSum: number }>();
  const placeCounts = new Map<string, Map<string, CellPlaceCount>>();
  for (const r of rawData) {
    const row = Number(r.row);
    const col = Number(r.col);
    const count = Number(r.count);
    const key = `${row}:${col}`;
    const label = PlaceLabel({
      country: r.placeCountry,
      region: r.placeRegion,
      city: r.placeCity,
    });
    let cell = byCell.get(key);
    if (!cell) {
      cell = {
        row,
        col,
        count: 0,
        centerLat: 0,
        centerLon: 0,
        placeLabel: null,
        placeCountry: null,
        placeRegion: null,
        placeCity: null,
        _latSum: 0,
        _lonSum: 0,
      };
      byCell.set(key, cell);
      placeCounts.set(key, new Map());
    }
    cell.count += count;
    cell._latSum += Number(r.centerLat) * count;
    cell._lonSum += Number(r.centerLon) * count;
    if (label) {
      const counts = placeCounts.get(key);
      const known = counts.get(label);
      if (known) {
        known.count += count;
      } else {
        counts.set(label, {
          count,
          country: r.placeCountry ?? null,
          region: r.placeRegion ?? null,
          city: r.placeCity ?? null,
        });
      }
    }
  }
  const cells: GeoGridCell[] = [...byCell.entries()].map(([key, cell]) => {
    const counts = placeCounts.get(key);
    let dominant: string | null = null;
    let dominantCount = -1;
    let dominantPlace: CellPlaceCount = null;
    for (const [label, place] of counts.entries()) {
      if (
        place.count > dominantCount ||
        (place.count === dominantCount && label < dominant)
      ) {
        dominant = label;
        dominantCount = place.count;
        dominantPlace = place;
      }
    }
    return {
      row: cell.row,
      col: cell.col,
      count: cell.count,
      centerLat: cell._latSum / cell.count,
      centerLon: cell._lonSum / cell.count,
      placeLabel: dominant,
      placeCountry: dominantPlace ? dominantPlace.country : null,
      placeRegion: dominantPlace ? dominantPlace.region : null,
      placeCity: dominantPlace ? dominantPlace.city : null,
    };
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  span.end();
  return { bbox, gridRows, gridCols, cells };
}

// Private Function

function fromRaw(fileRaw: any): File {
  const file = new File(fileRaw.accountId, fileRaw.folderId, fileRaw.filename);
  file.id = fileRaw.id;
  file.idCloud = fileRaw.idCloud;
  file.hash = fileRaw.hash;
  file.keywords = fileRaw.keywords ?? null;
  file.favorite = fileRaw.favorite ?? 0;
  file.dateSync = new Date(fileRaw.dateSync);
  file.dateUpdated = new Date(fileRaw.dateUpdated);
  file.dateMedia = new Date(fileRaw.dateMedia);
  file.info = JSON.parse(fileRaw.info);
  file.metadata = JSON.parse(fileRaw.metadata);
  file.placeCountry = fileRaw.placeCountry ?? null;
  file.placeCountryCode = fileRaw.placeCountryCode ?? null;
  file.placeRegion = fileRaw.placeRegion ?? null;
  file.placeCity = fileRaw.placeCity ?? null;
  file.placeStatus = fileRaw.placeStatus ?? null;
  return file;
}
