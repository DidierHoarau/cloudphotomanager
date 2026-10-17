import { SyncErrorDescribeHumanCause } from "./SyncErrorCatalog";

describe("SyncErrorDescribeHumanCause", () => {
  it("describes video preview generation failures", () => {
    const described = SyncErrorDescribeHumanCause(
      "Error getting Video Width",
      "syncVideoFromFull",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("Video preview could not be generated");
    expect(described!.action).toContain("rebuild its cache");
  });

  it("describes empty generated files as preview failures", () => {
    const described = SyncErrorDescribeHumanCause(
      "Generated file empty",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("unsupported or corrupt");
  });

  it("describes corrupt or truncated JPEGs", () => {
    const described = SyncErrorDescribeHumanCause(
      "VipsJpeg: Corrupt JPEG data: premature end of data segment",
      "syncPhotoFromFull",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("corrupt or truncated");
  });

  it("describes a missing temporary cache file", () => {
    const described = SyncErrorDescribeHumanCause(
      "ENOENT: no such file or directory, open '/tmp/cache/preview.webp'",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("Temporary cache file disappeared");
    expect(described!.action).toContain("Retry");
  });

  it("describes storage authentication failures", () => {
    const described = SyncErrorDescribeHumanCause(
      "Request failed with status code 401",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("authentication failed");
    expect(described!.action).toContain("Settings → Accounts");
  });

  it("describes files no longer present in the cloud", () => {
    const described = SyncErrorDescribeHumanCause(
      "ItemNotFound: item does not exist",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("no longer exists");
  });

  it("describes cloud thumbnail service rejections", () => {
    const described = SyncErrorDescribeHumanCause(
      "Request failed with status code 406",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("thumbnail service rejected");
  });

  it("describes timeouts", () => {
    const described = SyncErrorDescribeHumanCause(
      "Operation timed out after 30000 ms",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("took too long");
  });

  it("describes network connectivity failures", () => {
    const described = SyncErrorDescribeHumanCause(
      "getaddrinfo ENOTFOUND storage.example.net",
      "syncThumbnail",
    );
    expect(described).not.toBeNull();
    expect(described!.cause).toContain("Could not reach the storage provider");
  });

  it("returns null for an unmatched error", () => {
    expect(
      SyncErrorDescribeHumanCause(
        "Something entirely unexpected happened",
        "syncThumbnail",
      ),
    ).toBeNull();
  });

  it("returns null for a missing error message", () => {
    expect(SyncErrorDescribeHumanCause(undefined, "syncThumbnail")).toBeNull();
    expect(SyncErrorDescribeHumanCause("", "syncThumbnail")).toBeNull();
  });
});
