import { UtilsMd5 } from "./Utils";

describe("UtilsMd5", () => {
  it("should produce a 32-character hex string", () => {
    const result = UtilsMd5("hello");
    expect(result).toHaveLength(32);
    expect(/^[a-f0-9]{32}$/.test(result)).toBe(true);
  });

  it("should produce consistent output for the same input", () => {
    const input = "cloudphotomanager/test/file.jpg";
    expect(UtilsMd5(input)).toBe(UtilsMd5(input));
  });

  it("should produce different outputs for different inputs", () => {
    const hashA = UtilsMd5("foo");
    const hashB = UtilsMd5("bar");
    expect(hashA).not.toBe(hashB);
  });

  it("should handle empty string", () => {
    const result = UtilsMd5("");
    expect(result).toHaveLength(32);
    expect(/^[a-f0-9]{32}$/.test(result)).toBe(true);
  });

  it("should handle URI-encoded strings", () => {
    const result = UtilsMd5(encodeURI("accountId/folder/path/file.jpg"));
    expect(result).toHaveLength(32);
  });

  it("should handle special characters", () => {
    const result = UtilsMd5("!@#$%^&*()_+{}[]|\\:;\"'<>,.?/~`");
    expect(result).toHaveLength(32);
  });

  it("should handle unicode characters", () => {
    const result = UtilsMd5("照片/影像/file.jpg");
    expect(result).toHaveLength(32);
  });
});
