import {
  decimalToDms,
  dmsToDecimal,
  buildGpsInfo,
  extractGps,
  GpsInfo,
} from "./ExifGpsExtractor";

// ---------------------------------------------------------------------------
// Pure helper tests (no I/O)
// ---------------------------------------------------------------------------

describe("ExifGpsExtractor helpers", () => {
  describe("decimalToDms", () => {
    it("should convert a positive decimal to DMS", () => {
      // 40.4167820° N  → [40, 25, 0.4152]
      const [d, m, s] = decimalToDms(40.416782);
      expect(d).toBe(40);
      expect(m).toBe(25);
      expect(s).toBeCloseTo(0.4152, 2);
    });

    it("should convert a negative decimal to DMS (abs value)", () => {
      // -3.7035070° → [3, 42, 12.6252]
      const [d, m, s] = decimalToDms(-3.703507);
      expect(d).toBe(3);
      expect(m).toBe(42);
      expect(s).toBeCloseTo(12.6252, 1);
    });

    it("should return [0, 0, 0] for zero", () => {
      expect(decimalToDms(0)).toEqual([0, 0, 0]);
    });

    it("should handle high precision coordinates", () => {
      // Hong Kong: 22.3193039, 114.1693878
      const [d, m, s] = decimalToDms(22.3193039);
      expect(d).toBe(22);
      expect(m).toBe(19);
      expect(s).toBeCloseTo(9.494, 1);
    });
  });

  describe("dmsToDecimal", () => {
    it("should convert N/E refs to positive decimal", () => {
      const dec = dmsToDecimal([40, 25, 0.4152], "N");
      expect(dec).toBeCloseTo(40.416782, 4);
    });

    it("should negate for S ref", () => {
      const dec = dmsToDecimal([33, 51, 54], "S");
      expect(dec).toBeLessThan(0);
      expect(dec).toBeCloseTo(-33.865, 2);
    });

    it("should negate for W ref", () => {
      const dec = dmsToDecimal([3, 42, 12.6252], "W");
      expect(dec).toBeLessThan(0);
      expect(dec).toBeCloseTo(-3.70351, 3);
    });

    it("should be the inverse of decimalToDms for N", () => {
      const original = 40.416782;
      const dms = decimalToDms(original);
      const restored = dmsToDecimal(dms, "N");
      expect(restored).toBeCloseTo(original, 5);
    });

    it("should be the inverse of decimalToDms for S", () => {
      const original = -33.865;
      const dms = decimalToDms(original);
      const restored = dmsToDecimal(dms, "S");
      expect(restored).toBeCloseTo(original, 4);
    });
  });

  describe("buildGpsInfo", () => {
    it("should build correct GpsInfo for northern/eastern hemisphere", () => {
      const info = buildGpsInfo(40.416782, -3.703507);
      expect(info.GPSLatitudeRef).toBe("N");
      expect(info.GPSLongitudeRef).toBe("W");
      expect(info.GPSLatitudeDecimal).toBeCloseTo(40.416782, 6);
      expect(info.GPSLongitudeDecimal).toBeCloseTo(-3.703507, 6);
      expect(info.GPSLatitude).toHaveLength(3);
      expect(info.GPSLongitude).toHaveLength(3);
    });

    it("should set S/E refs correctly", () => {
      const info = buildGpsInfo(-33.865, 151.209);
      expect(info.GPSLatitudeRef).toBe("S");
      expect(info.GPSLongitudeRef).toBe("E");
    });

    it("should treat zero as N/E", () => {
      const info = buildGpsInfo(0, 0);
      expect(info.GPSLatitudeRef).toBe("N");
      expect(info.GPSLongitudeRef).toBe("E");
    });

    it("should satisfy the GpsInfo type contract", () => {
      const info: GpsInfo = buildGpsInfo(22.3, 114.1);
      expect(typeof info.GPSLatitudeRef).toBe("string");
      expect(typeof info.GPSLongitudeRef).toBe("string");
      expect(Array.isArray(info.GPSLatitude)).toBe(true);
      expect(Array.isArray(info.GPSLongitude)).toBe(true);
      expect(typeof info.GPSLatitudeDecimal).toBe("number");
      expect(typeof info.GPSLongitudeDecimal).toBe("number");
    });
  });
});

// ---------------------------------------------------------------------------
// extractGps integration-style tests (uses real buffers via exifr)
// ---------------------------------------------------------------------------

describe("extractGps", () => {
  it("should return null gpsInfo for a non-image buffer", async () => {
    const buf = Buffer.from("this is not an image");
    const result = await extractGps(buf);
    expect(result.gpsInfo).toBeNull();
  });

  it("should return null gpsInfo for a non-existent file path", async () => {
    const result = await extractGps("/non/existent/path.jpg");
    expect(result.gpsInfo).toBeNull();
  });

  it("should handle an empty buffer gracefully", async () => {
    const result = await extractGps(Buffer.alloc(0));
    expect(result.gpsInfo).toBeNull();
  });
});
