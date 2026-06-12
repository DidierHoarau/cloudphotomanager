/**
 * ExifGpsExtractor
 *
 * Advanced GPS location extraction from image files using `exifr`.
 *
 * Handles three tiers of location data:
 *   1. Standard EXIF GPS IFD (most accurate — exact coordinates)
 *   2. Xiaomi maker-note city tags (0x889D / 0x889E) when standard GPS is
 *      absent (city-level accuracy — requires geocoding)
 *   3. Returns null when no location data is available
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
  /** Source of the coordinates: "gps" = standard EXIF, "maker_note" = Xiaomi city tag geocoded */
  GPSSource: "gps" | "maker_note";
}

/** Xiaomi maker-note location hints (raw, un-geocoded) */
export interface XiaomiLocationHint {
  city: string | null;
  json: Record<string, unknown> | null;
}

export interface ExifGpsResult {
  gpsInfo: GpsInfo | null;
  xiaomiHint: XiaomiLocationHint | null;
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
export function buildGpsInfo(
  lat: number,
  lon: number,
  source: "gps" | "maker_note",
): GpsInfo {
  const latRef: "N" | "S" = lat >= 0 ? "N" : "S";
  const lonRef: "E" | "W" = lon >= 0 ? "E" : "W";
  return {
    GPSLatitudeRef: latRef,
    GPSLatitude: decimalToDms(lat),
    GPSLongitudeRef: lonRef,
    GPSLongitude: decimalToDms(lon),
    GPSLatitudeDecimal: parseFloat(lat.toFixed(7)),
    GPSLongitudeDecimal: parseFloat(lon.toFixed(7)),
    GPSSource: source,
  };
}

// ---------------------------------------------------------------------------
// Xiaomi maker-note parsing
// ---------------------------------------------------------------------------

/**
 * Extract Xiaomi proprietary tags from exifr output.
 * exifr exposes them under numeric string keys: "34973" (0x889D) and "34974" (0x889E).
 * Some builds use the raw IFD tag IDs: 0x889D (34973) and 0x889E (34974).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseXiaomiHint(
  exifData: Record<string, any> | undefined,
): XiaomiLocationHint | null {
  if (!exifData) return null;

  let city: string | null = null;
  let jsonMeta: Record<string, unknown> | null = null;

  // exifr may expose maker-note tags under various keys; scan for the known IDs
  const cityKeys = ["34973", "0x889D", "XIAOMI_CITY"];
  const jsonKeys = ["34974", "0x889E", "XIAOMI_JSON"];

  for (const key of cityKeys) {
    const val = exifData[key];
    if (typeof val === "string" && val.trim()) {
      city = val.trim();
      break;
    }
  }

  for (const key of jsonKeys) {
    const val = exifData[key];
    if (typeof val === "string" && val.trim()) {
      try {
        jsonMeta = JSON.parse(val) as Record<string, unknown>;
      } catch {
        // not valid JSON — ignore
      }
      break;
    } else if (val && typeof val === "object") {
      jsonMeta = val as Record<string, unknown>;
      break;
    }
  }

  if (!city && jsonMeta && typeof jsonMeta.customize === "string") {
    city = jsonMeta.customize as string;
  }

  if (!city && !jsonMeta) return null;
  return { city, json: jsonMeta };
}

// ---------------------------------------------------------------------------
// Geocoding (OpenStreetMap Nominatim — free, no API key)
// ---------------------------------------------------------------------------

interface GeocodedCity {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Forward-geocode a city name to coordinates via Nominatim.
 * Returns null on failure or no results.
 */
export async function geocodeCity(city: string): Promise<GeocodedCity | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "CloudPhotoManager/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (await resp.json()) as any[];
    if (!results.length) return null;
    return {
      lat: parseFloat(results[0].lat),
      lon: parseFloat(results[0].lon),
      displayName: results[0].display_name ?? city,
    };
  } catch {
    return null;
  }
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
    // Use { gps: true, tiff: true, exif: true } to get all IFDs + maker notes
    exifData = (await exifr.parse(input, {
      gps: true,
      tiff: true,
      exif: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as Record<string, any> | undefined;
  } catch {
    return { gpsInfo: null, xiaomiHint: null };
  }

  if (!exifData) {
    return { gpsInfo: null, xiaomiHint: null };
  }

  // --- Tier 1: Standard GPS coordinates ---
  const { latitude, longitude } = exifData as {
    latitude?: number;
    longitude?: number;
  };

  if (typeof latitude === "number" && typeof longitude === "number") {
    const gpsInfo = buildGpsInfo(latitude, longitude, "gps");
    const xiaomiHint = parseXiaomiHint(
      exifData as Record<string, unknown> | undefined,
    );
    return { gpsInfo, xiaomiHint };
  }

  // --- Tier 2: Xiaomi maker-note city fallback ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xiaomiHint = parseXiaomiHint(
    exifData as Record<string, any> | undefined,
  );
  if (xiaomiHint?.city) {
    const geocoded = await geocodeCity(xiaomiHint.city);
    if (geocoded) {
      const gpsInfo = buildGpsInfo(geocoded.lat, geocoded.lon, "maker_note");
      return { gpsInfo, xiaomiHint };
    }
  }

  // --- Tier 3: No location data ---
  return { gpsInfo: null, xiaomiHint };
}
