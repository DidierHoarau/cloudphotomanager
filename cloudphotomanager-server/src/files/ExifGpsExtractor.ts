/**
 * ExifGpsExtractor
 *
 * GPS location extraction from image files using `exifr`.
 *
 * Output is compatible with `exif-reader` v2 GPSInfo format so existing SQL
 * queries (SearchGeoSql) continue to work without changes. Decimal lat/lon
 * fields are also included for faster SQL reads on new data.
 */

import * as exifr from "exifr";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** GPSInfo stored in file.info.exif.GPSInfo — backward compatible with exif-reader v2 */
export interface GpsInfo {
  GPSLatitudeRef: "N" | "S";
  GPSLatitude: [number, number, number];
  GPSLongitudeRef: "E" | "W";
  GPSLongitude: [number, number, number];
  /** Decimal degrees (positive = N/E, negative = S/W) */
  GPSLatitudeDecimal: number;
  GPSLongitudeDecimal: number;
}

export interface ExifGpsResult {
  gpsInfo: GpsInfo | null;
}

// ---------------------------------------------------------------------------
// Decimal ↔ DMS helpers
// ---------------------------------------------------------------------------

/** Convert decimal degrees to a DMS tuple [degrees, minutes, seconds] */
export function decimalToDms(decimal: number): [number, number, number] {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = parseFloat(((mFloat - m) * 60).toFixed(4));
  return [d, m, s];
}

/** Convert a DMS tuple + ref to decimal degrees */
export function dmsToDecimal(
  dms: [number, number, number],
  ref: "N" | "S" | "E" | "W",
): number {
  const [d, m, s] = dms;
  const dec = d + m / 60 + s / 3600;
  return ref === "S" || ref === "W" ? -dec : dec;
}

/** Build a GpsInfo object from decimal lat/lon */
export function buildGpsInfo(lat: number, lon: number): GpsInfo {
  const latRef: "N" | "S" = lat >= 0 ? "N" : "S";
  const lonRef: "E" | "W" = lon >= 0 ? "E" : "W";
  return {
    GPSLatitudeRef: latRef,
    GPSLatitude: decimalToDms(lat),
    GPSLongitudeRef: lonRef,
    GPSLongitude: decimalToDms(lon),
    GPSLatitudeDecimal: parseFloat(lat.toFixed(7)),
    GPSLongitudeDecimal: parseFloat(lon.toFixed(7)),
  };
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract GPS location from an image file.
 *
 * @param input  File path (preferred) or Buffer containing the raw image bytes
 * @returns      Structured GPS result — null gpsInfo means no location found
 */
export async function extractGps(
  input: string | Buffer,
): Promise<ExifGpsResult> {
  let exifData: Record<string, unknown> | undefined;

  try {
    // exifr.parse accepts file paths, Buffers, and ArrayBuffers
    exifData = (await exifr.parse(input, {
      gps: true,
      tiff: true,
      exif: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as Record<string, any> | undefined;
  } catch {
    return { gpsInfo: null };
  }

  if (!exifData) {
    return { gpsInfo: null };
  }

  // Extract standard GPS coordinates
  const { latitude, longitude } = exifData as {
    latitude?: number;
    longitude?: number;
  };

  if (typeof latitude === "number" && typeof longitude === "number") {
    const gpsInfo = buildGpsInfo(latitude, longitude);
    return { gpsInfo };
  }

  // No location data
  return { gpsInfo: null };
}
