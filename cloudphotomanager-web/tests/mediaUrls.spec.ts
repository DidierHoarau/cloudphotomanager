import { describe, expect, it } from "vitest";
import { MediaUrls } from "../services/MediaUrls";

describe("MediaUrls", () => {
  it("prefers the signed media URLs returned by the API", () => {
    const file = {
      id: "file-1",
      thumbnailUrl: "/api/media/a/f/thumbnail.webp?exp=1&sig=s",
      previewUrl: "/api/media/a/f/preview.webp?exp=1&sig=s",
      videoPreviewUrl: "/api/media/a/f/preview.mp4?exp=1&sig=s",
    };
    expect(MediaUrls.thumbnail(file)).toBe(file.thumbnailUrl);
    expect(MediaUrls.imagePreview(file)).toBe(file.previewUrl);
    expect(MediaUrls.videoPreview(file)).toBe(file.videoPreviewUrl);
  });

  it("falls back to the authenticated legacy endpoints for thumbnails and previews", () => {
    const file = { id: "a/b" };
    expect(MediaUrls.thumbnail(file)).toBe(
      "/api/files/a%2Fb/thumbnail",
    );
    expect(MediaUrls.imagePreview(file)).toBe("/api/files/a%2Fb/preview");
    // No legacy endpoint serves video previews: never point at an unrelated URL.
    expect(MediaUrls.videoPreview(file)).toBe("");
  });

  it("returns empty strings for missing files", () => {
    expect(MediaUrls.thumbnail(null)).toBe("");
    expect(MediaUrls.imagePreview(undefined)).toBe("");
    expect(MediaUrls.videoPreview(null)).toBe("");
  });
});
