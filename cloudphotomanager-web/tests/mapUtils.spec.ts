import { describe, expect, it } from "vitest";

import {
  cellSearchQuery,
  cellSubBbox,
  formatCellLabel,
  gridDimensionsForZoom,
  MAP_ZOOM_DEFAULT,
  mapViewKey,
  parseCoordinate,
  parseMapView,
  parseZoom,
  readMapView,
  storeMapView,
} from "../services/MapUtils";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("MapUtils", () => {
  it("clamps zoom and defaults invalid values", () => {
    expect(parseZoom("3")).toBe(3);
    expect(parseZoom(25)).toBe(19);
    expect(parseZoom(-4)).toBe(2);
    expect(parseZoom("nope")).toBe(MAP_ZOOM_DEFAULT);
  });

  it("parses coordinates and full deep-link views", () => {
    expect(parseCoordinate("48.5")).toBe(48.5);
    expect(parseCoordinate("x")).toBeNull();
    expect(parseMapView({ lat: "48.1", lon: "-1.6", zoom: "12" })).toEqual({
      lat: 48.1,
      lon: -1.6,
      zoom: 12,
    });
    expect(parseMapView({ lat: "north", lon: "1" })).toBeNull();
  });

  it("uses a coarser grid at low zoom", () => {
    expect(gridDimensionsForZoom(2)).toEqual({ rows: 4, cols: 3 });
    expect(gridDimensionsForZoom(4)).toEqual({ rows: 6, cols: 4 });
    expect(gridDimensionsForZoom(7)).toEqual({ rows: 8, cols: 5 });
    expect(gridDimensionsForZoom(14)).toEqual({ rows: 10, cols: 10 });
  });

  it("computes the sub-bbox of a cell", () => {
    const bbox = { minLat: 48, maxLat: 49, minLon: 2, maxLon: 4 };
    expect(cellSubBbox(bbox, { row: 0, col: 0 }, 2, 2)).toEqual({
      minLat: 48,
      maxLat: 48.5,
      minLon: 2,
      maxLon: 3,
    });
    expect(cellSubBbox(bbox, { row: 1, col: 1 }, 2, 2)).toEqual({
      minLat: 48.5,
      maxLat: 49,
      minLon: 3,
      maxLon: 4,
    });
  });

  it("labels cells by place name, falling back to Cell r/c", () => {
    expect(
      formatCellLabel({
        row: 1,
        col: 2,
        count: 3,
        centerLat: 0,
        centerLon: 0,
        placeLabel: "Rennes, Brittany, France",
      }),
    ).toBe("Rennes, Brittany, France");
    expect(
      formatCellLabel({
        row: 1,
        col: 2,
        count: 3,
        centerLat: 0,
        centerLon: 0,
        placeLabel: null,
      }),
    ).toBe("Cell 1/2");
  });

  it("round-trips the map view per account through storage", () => {
    const storage = memoryStorage();
    const view = { lat: 48.11, lon: -1.67, zoom: 11 };
    storeMapView(storage, "account-a", view);
    expect(storage.getItem(mapViewKey("account-a"))).toBeTruthy();
    expect(readMapView(storage, "account-a")).toEqual(view);
    expect(readMapView(storage, "account-b")).toBeNull();
  });

  it("ignores corrupt persisted views", () => {
    const storage = memoryStorage();
    storage.setItem(mapViewKey("account-a"), "{not json");
    expect(readMapView(storage, "account-a")).toBeNull();
  });

  it("builds the cell search query for the summary page", () => {
    const bbox = { minLat: 48, maxLat: 49, minLon: 2, maxLon: 3 };
    expect(cellSearchQuery("account-a", bbox)).toEqual({
      accountId: "account-a",
      bbox: "48,49,2,3",
    });
    expect(
      cellSearchQuery("account-a", bbox, { country: "France", city: "Rennes" }),
    ).toEqual({
      accountId: "account-a",
      bbox: "48,49,2,3",
      placeCountry: "France",
      placeCity: "Rennes",
    });
  });
});
