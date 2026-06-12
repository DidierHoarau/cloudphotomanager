// SQL fragments to read GPS coordinates from the JSON `info` column.
//
// Two GPS storage formats are supported:
//
//  1. **Decimal** (new, written by ExifGpsExtractor via exifr):
//     info.exif.GPSInfo.GPSLatitudeDecimal / GPSLongitudeDecimal
//     These are pre-computed float values; SQL is cheap and direct.
//
//  2. **DMS arrays** (legacy, written by exif-reader v2):
//     info.exif.GPSInfo.GPSLatitude = [D, M, S]
//     info.exif.GPSInfo.GPSLatitudeRef = 'N'|'S'
//     Decimal = (D + M/60 + S/3600) * (ref == 'S'|'W' ? -1 : 1)
//
// COALESCE picks the decimal field first; if absent (old data), the DMS
// expression is evaluated as a fallback. This keeps all existing rows
// working without a migration while new rows are read in a single
// json_extract call.

// --- Latitude ---------------------------------------------------------------

const _DMS_LAT =
  "(" +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[0]'), 0) + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[1]'), 0) / 60.0 + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[2]'), 0) / 3600.0" +
  ") * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLatitudeRef') = 'S' THEN -1 ELSE 1 END)";

export const GEO_LAT_EXPR =
  "COALESCE(" +
  "  json_extract(info, '$.exif.GPSInfo.GPSLatitudeDecimal'), " +
  `  ${_DMS_LAT}` +
  ")";

// --- Longitude --------------------------------------------------------------

const _DMS_LON =
  "(" +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[0]'), 0) + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[1]'), 0) / 60.0 + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[2]'), 0) / 3600.0" +
  ") * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLongitudeRef') = 'W' THEN -1 ELSE 1 END)";

export const GEO_LON_EXPR =
  "COALESCE(" +
  "  json_extract(info, '$.exif.GPSInfo.GPSLongitudeDecimal'), " +
  `  ${_DMS_LON}` +
  ")";

// Filters out files without a parsed GPSInfo block. A row qualifies if
// either the new decimal field OR the legacy DMS array is present for
// both latitude and longitude.
export const GEO_PRESENT_CONDITION =
  " ( " +
  "   json_extract(info, '$.exif.GPSInfo.GPSLatitudeDecimal') IS NOT NULL " +
  "   OR json_extract(info, '$.exif.GPSInfo.GPSLatitude[0]') IS NOT NULL " +
  " ) " +
  " AND ( " +
  "   json_extract(info, '$.exif.GPSInfo.GPSLongitudeDecimal') IS NOT NULL " +
  "   OR json_extract(info, '$.exif.GPSInfo.GPSLongitude[0]') IS NOT NULL " +
  " ) ";

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isValidGeoBox(box: any): box is GeoBox {
  return (
    box !== null &&
    box !== undefined &&
    typeof box.minLat === "number" &&
    typeof box.maxLat === "number" &&
    typeof box.minLon === "number" &&
    typeof box.maxLon === "number"
  );
}

// Returns an additional WHERE fragment (starting with " AND ") and the
// associated parameter list, restricting results to the bounding box and
// to files that actually have GPS data.
export function buildGeoBoxConditionSql(box: GeoBox): {
  sql: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[];
} {
  const sql =
    ` AND ${GEO_PRESENT_CONDITION} ` +
    ` AND ${GEO_LAT_EXPR} BETWEEN ? AND ? ` +
    ` AND ${GEO_LON_EXPR} BETWEEN ? AND ? `;
  return {
    sql,
    params: [box.minLat, box.maxLat, box.minLon, box.maxLon],
  };
}
