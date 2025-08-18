import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "../../../cloudphotomanager-server/src/utils-std-ts/StandardTracer";
import { Logger } from "../../../cloudphotomanager-server/src/utils-std-ts/Logger";
import * as fs from "fs";
import * as path from "path";

const logger = new Logger("AnalysisLocation");

// Load cities data once (e.g., from a JSON file generated from GeoNames or SimpleMaps)
const cities: { name: string; lat: number; lon: number }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "cities.min.json"), "utf-8")
);

// Haversine formula
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AnalysisLocationGetExifLocation(
  context: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exifData: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let city = null;
  const span = StandardTracerStartSpan(
    "AnalysisLocationGetExifLocation",
    context
  );
  console.log(exifData);
  if (exifData.GPSInfo) {
    const gpsLocation = gpsToDecimal(exifData.GPSInfo);
    try {
      // Find nearest city offline
      let minDist = Infinity;
      for (const c of cities) {
        const dist = haversine(
          gpsLocation.latitude,
          gpsLocation.longitude,
          c.lat,
          c.lon
        );
        if (dist < minDist) {
          minDist = dist;
          city = c;
        }
      }
      console.log(city);
    } catch (err) {
      logger.info(
        `Could not find nearest city for GPS (${gpsLocation.latitude}, ${gpsLocation.longitude})`
      );
    }
  }
  span.end();
  return city;
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gpsToDecimal(gpsInfo: any) {
  const latRef = gpsInfo.GPSLatitudeRef || "N";
  const lonRef = gpsInfo.GPSLongitudeRef || "E";

  const lat = dmsToDecimal(gpsInfo.GPSLatitude);
  const lon = dmsToDecimal(gpsInfo.GPSLongitude);

  const latitude = latRef === "S" ? -lat : lat;
  const longitude = lonRef === "W" ? -lon : lon;

  let altitude = null;
  if (
    gpsInfo.GPSAltitude !== undefined &&
    gpsInfo.GPSAltitudeRef !== undefined
  ) {
    // GPSAltitudeRef is usually a number where 0 = above sea level, 1 = below
    const ref = gpsInfo.GPSAltitudeRef;
    const alt = gpsInfo.GPSAltitude;
    altitude = ref === 1 ? -alt : alt;
  }

  return { latitude, longitude, altitude };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dmsToDecimal(dms: any) {
  return dms[0] + dms[1] / 60 + dms[2] / 3600;
}
