// Local reverse geocoder backed by the bundled GeoNames-derived dataset.
//
// No network call is made at runtime: the nearest populated place is looked up
// in an in-memory 1-degree grid. Files in oceans or very sparse areas resolve
// to `status: "none"` instead of an approximate/fabricated place.

import { File } from "../model/File";
import { GpsCoordsFromInfo } from "../files/ExifGpsExtractor";
import placesData from "./data/places.json";

// Beyond this distance from the nearest populated place the file is
// considered "no place" (ocean, desert, polar regions).
export const PLACE_MAX_DISTANCE_KM = 300;
const DEGREE_GRID = 1;
const EARTH_RADIUS_KM = 6371;

export type PlaceTuple = [
  name: string,
  countryCode: string,
  admin1: string,
  lat: number,
  lon: number,
  population: number,
];

export interface PlacesDataset {
  countries: Record<string, string>;
  regions: Record<string, string>;
  places: PlaceTuple[];
}

export interface PlaceInfo {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

export interface PlaceResolution extends PlaceInfo {
  status: "ok" | "none";
  distanceKm: number | null;
}

interface IndexedPlace {
  name: string;
  countryCode: string;
  admin1: string;
  lat: number;
  lon: number;
  population: number;
}

export interface PlaceGeocoderInstance {
  resolve(lat: number, lon: number): PlaceResolution;
  fillFile(file: File): boolean;
}

function normalizeLongitude(lon: number): number {
  let value = lon;
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

function bucketKey(lat: number, lon: number): string {
  return `${Math.floor(lat / DEGREE_GRID)}:${Math.floor(lon / DEGREE_GRID)}`;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function PlaceGeocoderFromDataset(
  dataset: PlacesDataset,
): PlaceGeocoderInstance {
  const buckets = new Map<string, IndexedPlace[]>();
  for (const [name, countryCode, admin1, lat, lon, population] of dataset.places) {
    const place: IndexedPlace = {
      name,
      countryCode,
      admin1,
      lat,
      lon,
      population,
    };
    const key = bucketKey(lat, lon);
    const list = buckets.get(key);
    if (list) {
      list.push(place);
    } else {
      buckets.set(key, [place]);
    }
  }

  function nearest(lat: number, lon: number): {
    place: IndexedPlace;
    distanceKm: number;
  } | null {
    // 1 degree of latitude is ~111 km. The longitude bound widens with
    // latitude (and is capped at the full circle near the poles).
    const latDelta = PLACE_MAX_DISTANCE_KM / 111 + DEGREE_GRID;
    const cosLat = Math.max(Math.cos((Math.abs(lat) * Math.PI) / 180), 0.01);
    const lonDelta =
      PLACE_MAX_DISTANCE_KM / (111 * cosLat) + DEGREE_GRID;
    const scanAllLongitudes = lonDelta >= 180;

    const visited = new Set<string>();
    let best: IndexedPlace = null;
    let bestDistance = Infinity;
    const minLatBucket = Math.floor((lat - latDelta) / DEGREE_GRID);
    const maxLatBucket = Math.floor((lat + latDelta) / DEGREE_GRID);
    const minLonBucket = scanAllLongitudes
      ? -180
      : Math.floor((lon - lonDelta) / DEGREE_GRID);
    const maxLonBucket = scanAllLongitudes
      ? 179
      : Math.floor((lon + lonDelta) / DEGREE_GRID);

    for (let latBucket = minLatBucket; latBucket <= maxLatBucket; latBucket++) {
      if (latBucket < -90 || latBucket > 90) continue;
      for (let lonBucket = minLonBucket; lonBucket <= maxLonBucket; lonBucket++) {
        const key = bucketKey(latBucket, normalizeLongitude(lonBucket));
        if (visited.has(key)) continue;
        visited.add(key);
        const places = buckets.get(key);
        if (!places) continue;
        for (const place of places) {
          const distance = haversineKm(lat, lon, place.lat, place.lon);
          if (
            distance < bestDistance - 1 ||
            (Math.abs(distance - bestDistance) <= 1 &&
              best &&
              place.population > best.population)
          ) {
            best = place;
            bestDistance = distance;
          }
        }
      }
    }
    return best ? { place: best, distanceKm: bestDistance } : null;
  }

  function resolve(lat: number, lon: number): PlaceResolution {
    const found = nearest(lat, lon);
    if (!found || found.distanceKm > PLACE_MAX_DISTANCE_KM) {
      return {
        status: "none",
        country: null,
        countryCode: null,
        region: null,
        city: null,
        distanceKm: found ? found.distanceKm : null,
      };
    }
    const { place } = found;
    return {
      status: "ok",
      country: dataset.countries[place.countryCode] ?? place.countryCode,
      countryCode: place.countryCode,
      region: place.admin1
        ? (dataset.regions[`${place.countryCode}.${place.admin1}`] ?? null)
        : null,
      city: place.name,
      distanceKm: found.distanceKm,
    };
  }

  function fillFile(file: File): boolean {
    const coords = GpsCoordsFromInfo(file?.info);
    if (!coords) {
      return false;
    }
    const resolution = resolve(coords.lat, coords.lon);
    const next = {
      placeCountry: resolution.country,
      placeCountryCode: resolution.countryCode,
      placeRegion: resolution.region,
      placeCity: resolution.city,
      placeStatus: resolution.status,
    };
    let changed = false;
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (file[key] !== next[key]) {
        file[key] = next[key];
        changed = true;
      }
    }
    return changed;
  }

  return { resolve, fillFile };
}

let defaultGeocoder: PlaceGeocoderInstance = null;

function defaultGeocoderGet(): PlaceGeocoderInstance {
  if (!defaultGeocoder) {
    defaultGeocoder = PlaceGeocoderFromDataset(placesData as unknown as PlacesDataset);
  }
  return defaultGeocoder;
}

export function PlaceGeocoderResolve(
  lat: number,
  lon: number,
): PlaceResolution {
  return defaultGeocoderGet().resolve(lat, lon);
}

export function PlaceGeocoderDefault(): PlaceGeocoderInstance {
  return defaultGeocoderGet();
}

export function PlaceGeocoderFillFile(file: File): boolean {
  return defaultGeocoderGet().fillFile(file);
}

export function PlaceLabel(place: Partial<PlaceInfo>): string | null {
  if (!place) {
    return null;
  }
  const parts = [place.city, place.region, place.country].filter(
    (part) => part && String(part).trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}
