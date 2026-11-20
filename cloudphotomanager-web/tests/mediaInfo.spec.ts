import { describe, expect, it } from "vitest";

import { formatCaptureDate, formatPlace } from "../utils/MediaInfo";

describe("formatCaptureDate", () => {
  it("returns an empty string for missing, invalid or epoch values", () => {
    for (const value of [null, undefined, "", "not-a-date", 0, new Date(0)]) {
      expect(formatCaptureDate(value)).toBe("");
    }
  });

  it("formats a valid date with the year", () => {
    const formatted = formatCaptureDate(new Date("2024-03-15T12:00:00Z"));
    expect(formatted).not.toBe("");
    expect(formatted).toContain("2024");
  });
});

describe("formatPlace", () => {
  it("joins city, region and country", () => {
    expect(
      formatPlace({
        placeCity: "Rennes",
        placeRegion: "Brittany",
        placeCountry: "France",
      }),
    ).toBe("Rennes, Brittany, France");
  });

  it("handles partial and empty places", () => {
    expect(formatPlace({ placeCity: "Rennes" })).toBe("Rennes");
    expect(
      formatPlace({ placeCity: "", placeRegion: "Brittany", placeCountry: "" }),
    ).toBe("Brittany");
    expect(formatPlace({})).toBe("");
    expect(formatPlace(null)).toBe("");
  });
});
