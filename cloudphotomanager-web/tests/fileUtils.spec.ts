import { describe, expect, it } from "vitest";

import { FileUtils } from "../services/FileUtils";
import {
  FILE_MEDIA_TYPE_EXTENSIONS,
  FileMediaType,
} from "../../cloudphotomanager-server/src/model/FileMediaType";

describe("FileUtils.getType", () => {
  it.each([
    ["photo.tiff", "image"],
    ["photo.jpg", "image"],
    ["photo.raw", "imageRaw"],
    ["photo.arw", "imageRaw"],
    ["photo.heic", "imageRaw"],
    ["photo.dng", "imageRaw"],
    ["video.mp4", "video"],
    ["document.txt", "unknown"],
  ])("classifies %s as %s", (filename, expected) => {
    expect(FileUtils.getType({ filename })).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(FileUtils.getType({ filename: "photo.TIFF" })).toBe("image");
    expect(FileUtils.getType({ filename: "photo.HEIC" })).toBe("imageRaw");
  });

  it("prefers the server-supplied mediaType", () => {
    expect(
      FileUtils.getType({
        filename: "photo.jpg",
        mediaType: FileMediaType.imageRaw,
      }),
    ).toBe("imageRaw");
  });

  // The server mapping is the source of truth: the web fallback may not drift.
  it("stays in sync with the server extension mapping", () => {
    for (const [mediaType, extensions] of Object.entries(
      FILE_MEDIA_TYPE_EXTENSIONS,
    )) {
      for (const extension of extensions) {
        expect(FileUtils.getType({ filename: `x.${extension}` })).toBe(
          mediaType,
        );
      }
    }
  });
});

describe("FileUtils.isImage", () => {
  it("is true for image and imageRaw, false otherwise", () => {
    expect(FileUtils.isImage({ filename: "photo.jpg" })).toBe(true);
    expect(FileUtils.isImage({ filename: "photo.heic" })).toBe(true);
    expect(FileUtils.isImage({ filename: "video.mp4" })).toBe(false);
    expect(FileUtils.isImage({ filename: "document.txt" })).toBe(false);
  });
});

describe("FileUtils.isOuttake", () => {
  it("matches the exact -outtake.<ext> suffix", () => {
    expect(FileUtils.isOuttake({ filename: "x-outtake.jpg" })).toBe(true);
    expect(FileUtils.isOuttake({ filename: "x-outtake.raw" })).toBe(true);
    expect(FileUtils.isOuttake({ filename: "x-outtake2.jpg" })).toBe(false);
    expect(FileUtils.isOuttake({ filename: "outtake-x.jpg" })).toBe(false);
    expect(FileUtils.isOuttake({ filename: "x.jpg" })).toBe(false);
    expect(FileUtils.isOuttake({})).toBe(false);
    expect(FileUtils.isOuttake(null)).toBe(false);
  });
});
