import { describe, expect, it } from "vitest";

import {
  buildDateFilters,
  filterLabels,
  parseBboxQuery,
  parsePlaceKey,
  placeFilterQuery,
  placeKey,
  SORT_DEFAULT,
  SORT_OPTIONS,
  sumCounts,
} from "../utils/SearchFilters";

describe("SearchFilters", () => {
  it("exposes the sort whitelist with a valid default", () => {
    expect(SORT_OPTIONS).toHaveLength(6);
    expect(SORT_OPTIONS.map((option) => option.value)).toContain(SORT_DEFAULT);
  });

  it("expands a same-day range to the whole local day", () => {
    const filters = buildDateFilters("2024-05-17", "2024-05-17");
    expect(filters.dateFrom).toBe(
      new Date(2024, 4, 17, 0, 0, 0, 0).toISOString(),
    );
    expect(filters.dateTo).toBe(
      new Date(2024, 4, 17, 23, 59, 59, 999).toISOString(),
    );
  });

  it("omits invalid or missing dates", () => {
    expect(buildDateFilters("", null)).toEqual({});
    expect(buildDateFilters("2024-02-30", "nope")).toEqual({});
  });

  it("parses a valid bbox query", () => {
    expect(parseBboxQuery("48,49,2,3")).toEqual({
      minLat: 48,
      maxLat: 49,
      minLon: 2,
      maxLon: 3,
    });
    expect(parseBboxQuery("48,49,3,2")).toBeNull();
    expect(parseBboxQuery("a,b,c,d")).toBeNull();
    expect(parseBboxQuery("48,49,2")).toBeNull();
    expect(parseBboxQuery(undefined)).toBeNull();
  });

  it("filters labels case-insensitively beyond the first 50", () => {
    const labels = Array.from({ length: 120 }, (_, index) => ({
      label: `Label ${index}`,
      count: 1,
    }));
    expect(filterLabels(labels, "label 11")).toHaveLength(11);
    expect(filterLabels(labels, "LABEL 119")).toEqual([
      { label: "Label 119", count: 1 },
    ]);
    expect(filterLabels(labels, "  ")).toHaveLength(120);
  });

  it("round-trips place keys and builds their query", () => {
    const place = {
      country: "France",
      countryCode: "FR",
      region: "Brittany",
      city: "Rennes",
    };
    expect(parsePlaceKey(placeKey(place))).toEqual(place);
    expect(placeFilterQuery(place)).toEqual({
      placeCountry: "France",
      placeRegion: "Brittany",
      placeCity: "Rennes",
    });
    expect(parsePlaceKey("not json")).toBeNull();
    expect(parsePlaceKey(placeKey({ country: "France" }))).toBeNull();
  });

  it("sums counts", () => {
    expect(sumCounts([{ count: 2 }, { count: 3 }])).toBe(5);
    expect(sumCounts([])).toBe(0);
  });
});
