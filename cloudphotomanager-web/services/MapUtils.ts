// Pure helpers for the search map page: deep-link parsing, adaptive grid
// dimensions by zoom, cell geometry, accessible labels and the persisted view.

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface GeoGridCell {
  row: number;
  col: number;
  count: number;
  centerLat: number;
  centerLon: number;
  placeLabel?: string | null;
  placeCountry?: string | null;
  placeRegion?: string | null;
  placeCity?: string | null;
}

export const MAP_ZOOM_MIN = 2;
export const MAP_ZOOM_MAX = 19;
export const MAP_ZOOM_DEFAULT = 16;

export function parseCoordinate(value: any): number | null {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(num) ? num : null;
}

export function parseZoom(value: any): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  if (!Number.isFinite(num)) {
    return MAP_ZOOM_DEFAULT;
  }
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Math.round(num)));
}

export function parseMapView(query: any): MapView | null {
  const lat = parseCoordinate(query?.lat);
  const lon = parseCoordinate(query?.lon);
  if (
    lat === null ||
    lon === null ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }
  return { lat, lon, zoom: parseZoom(query?.zoom) };
}

// Fewer, larger cells at low zoom so dense regions stay readable; the
// long-standing 10x10 grid is kept at high zoom.
export function gridDimensionsForZoom(zoom: number): {
  rows: number;
  cols: number;
} {
  if (zoom <= 3) {
    return { rows: 4, cols: 3 };
  }
  if (zoom <= 5) {
    return { rows: 6, cols: 4 };
  }
  if (zoom <= 7) {
    return { rows: 8, cols: 5 };
  }
  return { rows: 10, cols: 10 };
}

export function cellSubBbox(
  bbox: GeoBox,
  cell: { row: number; col: number },
  rows: number,
  cols: number,
): GeoBox {
  const cellHeight = (bbox.maxLat - bbox.minLat) / rows;
  const cellWidth = (bbox.maxLon - bbox.minLon) / cols;
  return {
    minLat: bbox.minLat + cell.row * cellHeight,
    maxLat: bbox.minLat + (cell.row + 1) * cellHeight,
    minLon: bbox.minLon + cell.col * cellWidth,
    maxLon: bbox.minLon + (cell.col + 1) * cellWidth,
  };
}

export function formatCellLabel(
  cell: GeoGridCell,
  _rows?: number,
  _cols?: number,
): string {
  if (cell?.placeLabel) {
    return cell.placeLabel;
  }
  return `Cell ${cell.row}/${cell.col}`;
}

export function mapViewKey(accountId: string): string {
  return `cpm.mapView.${accountId}`;
}

export interface MapViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readMapView(
  storage: MapViewStorage,
  accountId: string,
): MapView | null {
  if (!storage || !accountId) {
    return null;
  }
  try {
    const raw = storage.getItem(mapViewKey(accountId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const view = parseMapView(parsed);
    return view;
  } catch {
    return null;
  }
}

export function storeMapView(
  storage: MapViewStorage,
  accountId: string,
  view: MapView,
): void {
  if (!storage || !accountId || !view) {
    return;
  }
  try {
    storage.setItem(
      mapViewKey(accountId),
      JSON.stringify({
        lat: view.lat,
        lon: view.lon,
        zoom: view.zoom,
      }),
    );
  } catch {
    // Storage can be unavailable (private mode / quota): the view is only a
    // convenience, so ignore failures.
  }
}

export function bboxToQuery(bbox: GeoBox): string {
  return [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon].join(",");
}

export function cellSearchQuery(
  accountId: string,
  bbox: GeoBox,
  place?: {
    country?: string;
    region?: string;
    city?: string;
  },
): Record<string, string> {
  const query: Record<string, string> = {
    accountId,
    bbox: bboxToQuery(bbox),
  };
  if (place?.country) query.placeCountry = place.country;
  if (place?.region) query.placeRegion = place.region;
  if (place?.city) query.placeCity = place.city;
  return query;
}
