// Pure helpers for the search filters: timezone-correct inclusive dates, the
// sort whitelist, deep-link bbox/place parsing and label filtering.

export const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "filename_asc", label: "Filename A-Z" },
  { value: "filename_desc", label: "Filename Z-A" },
  { value: "size_asc", label: "Smallest first" },
  { value: "size_desc", label: "Largest first" },
];

export const SORT_DEFAULT = "date_desc";

export interface DateFilters {
  dateFrom?: string;
  dateTo?: string;
}

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateInput(value: string): [number, number, number] | null {
  const match = DATE_INPUT_PATTERN.exec(String(value ?? "").trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

// The date inputs carry a calendar day without a timezone. Send the local
// start-of-day / end-of-day ISO strings so a same-day from/to range covers the
// whole day in the user's timezone and the server can use `>=` / `<=`.
export function buildDateFilters(
  from: string | null | undefined,
  to: string | null | undefined,
): DateFilters {
  const filters: DateFilters = {};
  const fromParts = from ? parseDateInput(from) : null;
  if (fromParts) {
    filters.dateFrom = new Date(
      fromParts[0],
      fromParts[1] - 1,
      fromParts[2],
      0,
      0,
      0,
      0,
    ).toISOString();
  }
  const toParts = to ? parseDateInput(to) : null;
  if (toParts) {
    filters.dateTo = new Date(
      toParts[0],
      toParts[1] - 1,
      toParts[2],
      23,
      59,
      59,
      999,
    ).toISOString();
  }
  return filters;
}

export interface ParsedBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

// Deep-link format: "minLat,maxLat,minLon,maxLon".
export function parseBboxQuery(value: any): ParsedBbox | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(",");
  if (parts.length !== 4) {
    return null;
  }
  const [minLat, maxLat, minLon, maxLon] = parts.map((part) => Number(part));
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) {
    return null;
  }
  if (
    minLat < -90 ||
    maxLat > 90 ||
    minLon < -180 ||
    maxLon > 180 ||
    minLat >= maxLat ||
    minLon >= maxLon
  ) {
    return null;
  }
  return { minLat, maxLat, minLon, maxLon };
}

export function filterLabels(
  labels: { label: string; count: number }[],
  query: string,
): { label: string; count: number }[] {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) {
    return labels;
  }
  return labels.filter((entry) =>
    String(entry.label).toLowerCase().includes(needle),
  );
}

export interface PlaceFilter {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
}

export function placeKey(place: PlaceFilter): string {
  return JSON.stringify([
    place?.country ?? "",
    place?.countryCode ?? "",
    place?.region ?? "",
    place?.city ?? "",
  ]);
}

export function parsePlaceKey(key: string): PlaceFilter | null {
  if (!key) {
    return null;
  }
  try {
    const parts = JSON.parse(key);
    if (!Array.isArray(parts) || parts.length !== 4) {
      return null;
    }
    const [country, countryCode, region, city] = parts;
    const place: PlaceFilter = {};
    if (country) place.country = String(country);
    if (countryCode) place.countryCode = String(countryCode);
    if (region) place.region = String(region);
    if (city) place.city = String(city);
    return place.city || place.region ? place : null;
  } catch {
    return null;
  }
}

export function placeFilterQuery(place: PlaceFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (place?.country) query.placeCountry = place.country;
  if (place?.region) query.placeRegion = place.region;
  if (place?.city) query.placeCity = place.city;
  return query;
}

export function sumCounts(entries: { count: number }[]): number {
  return entries.reduce((total, entry) => total + Number(entry.count ?? 0), 0);
}
