import { describe, expect, it } from "vitest";

import { GeoUtils } from "../services/GeoUtils";

describe("GeoUtils.getGpsCoords", () => {
  it("reads the pre-computed decimal coordinates", () => {
    const file = {
      info: {
        exif: {
          GPSInfo: {
            GPSLatitudeDecimal: 48.85837,
            GPSLongitudeDecimal: 2.29448,
          },
        },
      },
    };
    expect(GeoUtils.getGpsCoords(file)).toEqual({
      lat: 48.85837,
      lon: 2.29448,
    });
  });

  it("converts DMS arrays with N/E refs to positive decimals", () => {
    const file = {
      info: {
        exif: {
          GPSInfo: {
            GPSLatitude: [48, 51, 29.4],
            GPSLatitudeRef: "N",
            GPSLongitude: [2, 17, 40.2],
            GPSLongitudeRef: "E",
          },
        },
      },
    };
    const coords = GeoUtils.getGpsCoords(file);
    expect(coords.lat).toBeCloseTo(48 + 51 / 60 + 29.4 / 3600, 10);
    expect(coords.lon).toBeCloseTo(2 + 17 / 60 + 40.2 / 3600, 10);
  });

  it("negates DMS arrays with S/W refs", () => {
    const file = {
      info: {
        exif: {
          GPSInfo: {
            GPSLatitude: [33, 51, 0],
            GPSLatitudeRef: "S",
            GPSLongitude: [151, 12, 0],
            GPSLongitudeRef: "W",
          },
        },
      },
    };
    const coords = GeoUtils.getGpsCoords(file);
    expect(coords.lat).toBeCloseTo(-(33 + 51 / 60), 10);
    expect(coords.lon).toBeCloseTo(-(151 + 12 / 60), 10);
  });

  it("prefers decimal values over the DMS arrays", () => {
    const file = {
      info: {
        exif: {
          GPSInfo: {
            GPSLatitudeDecimal: 1.5,
            GPSLongitudeDecimal: 2.5,
            GPSLatitude: [10, 0, 0],
            GPSLatitudeRef: "N",
            GPSLongitude: [20, 0, 0],
            GPSLongitudeRef: "E",
          },
        },
      },
    };
    expect(GeoUtils.getGpsCoords(file)).toEqual({ lat: 1.5, lon: 2.5 });
  });

  it("returns null when GPS data is missing or incomplete", () => {
    expect(GeoUtils.getGpsCoords({})).toBeNull();
    expect(GeoUtils.getGpsCoords({ info: {} })).toBeNull();
    expect(
      GeoUtils.getGpsCoords({
        info: { exif: { GPSInfo: { GPSLatitudeDecimal: 1.5 } } },
      }),
    ).toBeNull();
    expect(
      GeoUtils.getGpsCoords({
        info: {
          exif: {
            GPSInfo: {
              GPSLatitude: [10, 0, 0],
              GPSLatitudeRef: "N",
            },
          },
        },
      }),
    ).toBeNull();
  });

  it("returns null for malformed DMS values", () => {
    expect(
      GeoUtils.getGpsCoords({
        info: {
          exif: {
            GPSInfo: {
              GPSLatitude: ["a", "b"],
              GPSLatitudeRef: "N",
              GPSLongitude: [2, 0, 0],
              GPSLongitudeRef: "E",
            },
          },
        },
      }),
    ).toBeNull();
    expect(
      GeoUtils.getGpsCoords({
        info: {
          exif: {
            GPSInfo: {
              GPSLatitude: [NaN, 0, 0],
              GPSLatitudeRef: "N",
              GPSLongitude: [2, 0, 0],
              GPSLongitudeRef: "E",
            },
          },
        },
      }),
    ).toBeNull();
  });

  it("returns null for non-finite decimal values", () => {
    expect(
      GeoUtils.getGpsCoords({
        info: {
          exif: {
            GPSInfo: {
              GPSLatitudeDecimal: NaN,
              GPSLongitudeDecimal: 2.5,
            },
          },
        },
      }),
    ).toBeNull();
  });
});
