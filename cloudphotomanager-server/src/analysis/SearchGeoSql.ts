// SQL fragments to read GPS coordinates from the JSON `info` column
// (stored under info.exif.GPSInfo by SyncFileCache). Decimal degrees
// are negated for southern latitudes / western longitudes via the
// GPSLatitudeRef / GPSLongitudeRef tags. Centralized here so the
// search filter and the geo-grid aggregation share one source of truth.

export const GEO_LAT_EXPR =
  "(json_extract(info, '$.exif.GPSInfo.GPSLatitude') * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLatitudeRef') = 'S' THEN -1 ELSE 1 END))";

export const GEO_LON_EXPR =
  "(json_extract(info, '$.exif.GPSInfo.GPSLongitude') * " +
  "(CASE WHEN json_extract(info, '$.exif.GPSInfo.GPSLongitudeRef') = 'W' THEN -1 ELSE 1 END))";

// Filters out files without a parsed GPSInfo block.
export const GEO_PRESENT_CONDITION =
  " json_extract(info, '$.exif.GPSInfo.GPSLatitude') IS NOT NULL " +
  " AND json_extract(info, '$.exif.GPSInfo.GPSLongitude') IS NOT NULL ";

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
