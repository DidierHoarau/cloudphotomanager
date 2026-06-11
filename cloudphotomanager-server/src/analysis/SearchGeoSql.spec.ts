import {
  isValidGeoBox,
  buildGeoBoxConditionSql,
  GeoBox,
  GEO_LAT_EXPR,
  GEO_LON_EXPR,
  GEO_PRESENT_CONDITION,
} from "./SearchGeoSql";

describe("SearchGeoSql", () => {
  describe("GEO_LAT_EXPR", () => {
    it("should be a non-empty string", () => {
      expect(GEO_LAT_EXPR).toBeTruthy();
      expect(typeof GEO_LAT_EXPR).toBe("string");
    });

    it("should reference GPS latitude fields", () => {
      expect(GEO_LAT_EXPR).toContain("GPSLatitude");
      expect(GEO_LAT_EXPR).toContain("GPSLatitudeRef");
    });
  });

  describe("GEO_LON_EXPR", () => {
    it("should be a non-empty string", () => {
      expect(GEO_LON_EXPR).toBeTruthy();
      expect(typeof GEO_LON_EXPR).toBe("string");
    });

    it("should reference GPS longitude fields", () => {
      expect(GEO_LON_EXPR).toContain("GPSLongitude");
      expect(GEO_LON_EXPR).toContain("GPSLongitudeRef");
    });
  });

  describe("GEO_PRESENT_CONDITION", () => {
    it("should require both latitude and longitude GPS data", () => {
      expect(GEO_PRESENT_CONDITION).toContain("GPSLatitude");
      expect(GEO_PRESENT_CONDITION).toContain("GPSLongitude");
    });
  });

  describe("isValidGeoBox", () => {
    it("should return true for a complete valid GeoBox", () => {
      const box: GeoBox = { minLat: 22, maxLat: 23, minLon: 114, maxLon: 115 };
      expect(isValidGeoBox(box)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isValidGeoBox(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isValidGeoBox(undefined)).toBe(false);
    });

    it("should return false for an empty object", () => {
      expect(isValidGeoBox({})).toBe(false);
    });

    it("should return false when a field is missing", () => {
      const box = { minLat: 22, maxLat: 23, minLon: 114 };
      expect(isValidGeoBox(box)).toBe(false);
    });

    it("should return false when a field is not a number", () => {
      const box = {
        minLat: "22",
        maxLat: 23,
        minLon: 114,
        maxLon: 115,
      };
      expect(isValidGeoBox(box)).toBe(false);
    });
  });

  describe("buildGeoBoxConditionSql", () => {
    it("should return sql and params", () => {
      const result = buildGeoBoxConditionSql({
        minLat: 22,
        maxLat: 23,
        minLon: 114,
        maxLon: 115,
      });
      expect(result.sql).toBeTruthy();
      expect(typeof result.sql).toBe("string");
      expect(result.params).toBeInstanceOf(Array);
    });

    it("should include the GPS presence check", () => {
      const result = buildGeoBoxConditionSql({
        minLat: 22,
        maxLat: 23,
        minLon: 114,
        maxLon: 115,
      });
      expect(result.sql).toContain("GPSLatitude");
      expect(result.sql).toContain("GPSLongitude");
    });

    it("should use BETWEEN conditions for lat/lon", () => {
      const result = buildGeoBoxConditionSql({
        minLat: 22,
        maxLat: 23,
        minLon: 114,
        maxLon: 115,
      });
      expect(result.sql).toContain("BETWEEN");
      expect(result.sql).toContain("json_extract");
      expect(result.sql).toContain("GPSLatitude");
      expect(result.sql).toContain("GPSLongitude");
    });

    it("should include params for minLat, maxLat, minLon, maxLon in order", () => {
      const result = buildGeoBoxConditionSql({
        minLat: 22.3,
        maxLat: 23.5,
        minLon: 114.1,
        maxLon: 115.7,
      });
      expect(result.params).toEqual([22.3, 23.5, 114.1, 115.7]);
    });

    it("should start with AND", () => {
      const result = buildGeoBoxConditionSql({
        minLat: 22,
        maxLat: 23,
        minLon: 114,
        maxLon: 115,
      });
      expect(result.sql.startsWith(" AND ")).toBe(true);
    });
  });
});
