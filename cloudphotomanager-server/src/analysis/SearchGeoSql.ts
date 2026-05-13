// SQL fragments to read GPS coordinates from the JSON `info` column
// (stored under info.exif.GPSInfo by SyncFileCache, populated via
// `exif-reader` v2). exif-reader v2 stores GPSLatitude / GPSLongitude
// as DMS arrays of 3 numbers ([degrees, minutes, seconds]), with sign
// carried separately in GPSLatitudeRef / GPSLongitudeRef ('N'/'S',
// 'E'/'W'). Decimal degrees = D + M/60 + S/3600, then negated for
// southern latitudes / western longitudes. Centralized here so the
// search filter and the geo-grid aggregation share one source of truth.

export const GEO_LAT_EXPR =
  "((" +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[0]'), 0) + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[1]'), 0) / 60.0 + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLatitude[2]'), 0) / 3600.0" +
  ") * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLatitudeRef') = 'S' THEN -1 ELSE 1 END))";

export const GEO_LON_EXPR =
  "((" +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[0]'), 0) + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[1]'), 0) / 60.0 + " +
  "  COALESCE(json_extract(info, '$.exif.GPSInfo.GPSLongitude[2]'), 0) / 3600.0" +
  ") * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLongitudeRef') = 'W' THEN -1 ELSE 1 END))";

// Filters out files without a parsed GPSInfo block. Tests for the
// first DMS component (degrees) being present in both lat and lon.
export const GEO_PRESENT_CONDITION =
  " json_extract(info, '$.exif.GPSInfo.GPSLatitude[0]') IS NOT NULL " +
  " AND json_extract(info, '$.exif.GPSInfo.GPSLongitude[0]') IS NOT NULL ";

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isValidGeoBox(box: any): box is GeoBox {
  return (
    box &&
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
