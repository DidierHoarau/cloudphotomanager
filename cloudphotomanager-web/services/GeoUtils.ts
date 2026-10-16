export interface GeoCoords {
  lat: number;
  lon: number;
}

function dmsToDecimal(
  dms: any,
  ref: any,
  negativeRef: string,
): number | null {
  if (!Array.isArray(dms) || dms.length < 3) {
    return null;
  }
  const [d, m, s] = dms.map(Number);
  if (![d, m, s].every(Number.isFinite)) {
    return null;
  }
  const sign = ref === negativeRef ? -1 : 1;
  return sign * (d + m / 60 + s / 3600);
}

export class GeoUtils {
  // Reads GPS coordinates from the file info JSON, mirroring the server-side
  // SearchGeoSql.ts COALESCE logic: prefer the pre-computed decimal values,
  // fall back to the legacy DMS arrays + N/S/E/W refs.
  public static getGpsCoords(file: any): GeoCoords | null {
    const gps = file?.info?.exif?.GPSInfo;
    if (!gps) {
      return null;
    }
    let lat: number | null = null;
    if (
      typeof gps.GPSLatitudeDecimal === "number" &&
      Number.isFinite(gps.GPSLatitudeDecimal)
    ) {
      lat = gps.GPSLatitudeDecimal;
    } else {
      lat = dmsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef, "S");
    }
    let lon: number | null = null;
    if (
      typeof gps.GPSLongitudeDecimal === "number" &&
      Number.isFinite(gps.GPSLongitudeDecimal)
    ) {
      lon = gps.GPSLongitudeDecimal;
    } else {
      lon = dmsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef, "W");
    }
    if (lat === null || lon === null) {
      return null;
    }
    return { lat, lon };
  }
}
