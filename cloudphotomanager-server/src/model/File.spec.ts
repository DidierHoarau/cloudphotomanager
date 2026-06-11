import { File } from "./File";
import { FileMediaType } from "./FileMediaType";

describe("File", () => {
  describe("constructor", () => {
    it("should set accountId, folderId, filename from arguments", () => {
      const file = new File("acct1", "folder1", "photo.jpg");
      expect(file.accountId).toBe("acct1");
      expect(file.folderId).toBe("folder1");
      expect(file.filename).toBe("photo.jpg");
    });

    it("should generate a deterministic id based on URI-encoded input", () => {
      const file1 = new File("acct1", "folder1", "photo.jpg");
      const file2 = new File("acct1", "folder1", "photo.jpg");
      expect(file1.id).toBe(file2.id);
    });

    it("should generate different ids for different accountId", () => {
      const file1 = new File("acct1", "folder1", "photo.jpg");
      const file2 = new File("acct2", "folder1", "photo.jpg");
      expect(file1.id).not.toBe(file2.id);
    });

    it("should generate different ids for different folderId", () => {
      const file1 = new File("acct1", "folder1", "photo.jpg");
      const file2 = new File("acct1", "folder2", "photo.jpg");
      expect(file1.id).not.toBe(file2.id);
    });

    it("should generate different ids for different filename", () => {
      const file1 = new File("acct1", "folder1", "photo.jpg");
      const file2 = new File("acct1", "folder1", "photo2.jpg");
      expect(file1.id).not.toBe(file2.id);
    });

    it("should initialize info and metadata as empty objects", () => {
      const file = new File("acct1", "folder1", "photo.jpg");
      expect(file.info).toEqual({});
      expect(file.metadata).toEqual({});
    });

    it("should have a 32-character hex id", () => {
      const file = new File("acct1", "folder1", "photo.jpg");
      expect(file.id).toHaveLength(32);
      expect(/^[a-f0-9]{32}$/.test(file.id)).toBe(true);
    });
  });

  describe("getMediaType", () => {
    it.each([
      ["photo.jpg", FileMediaType.image],
      ["photo.jpeg", FileMediaType.image],
      ["photo.png", FileMediaType.image],
      ["photo.gif", FileMediaType.image],
      ["photo.webp", FileMediaType.image],
      ["photo.tiff", FileMediaType.image],
      ["photo.dng", FileMediaType.imageRaw],
      ["photo.raw", FileMediaType.imageRaw],
      ["photo.arw", FileMediaType.imageRaw],
      ["photo.heic", FileMediaType.imageRaw],
      ["video.mp4", FileMediaType.video],
      ["video.mov", FileMediaType.video],
      ["video.wmv", FileMediaType.video],
      ["video.avi", FileMediaType.video],
      ["video.mkv", FileMediaType.video],
      ["video.mpg", FileMediaType.video],
      ["video.mpeg", FileMediaType.video],
      ["video.flv", FileMediaType.video],
      ["document.txt", FileMediaType.unknown],
      ["document.pdf", FileMediaType.unknown],
      ["archive.zip", FileMediaType.unknown],
    ])("should recognize '%s' as %s", (name, expected) => {
      expect(File.getMediaType(name)).toBe(expected);
    });

    it("should handle uppercase extensions", () => {
      expect(File.getMediaType("photo.JPG")).toBe(FileMediaType.image);
      expect(File.getMediaType("video.MP4")).toBe(FileMediaType.video);
      expect(File.getMediaType("photo.HEIC")).toBe(FileMediaType.imageRaw);
    });

    it("should handle mixed-case extensions", () => {
      expect(File.getMediaType("photo.Jpg")).toBe(FileMediaType.image);
      expect(File.getMediaType("video.Mov")).toBe(FileMediaType.video);
    });

    it("should return unknown for files without extension", () => {
      expect(File.getMediaType("photo")).toBe(FileMediaType.unknown);
    });

    it("should return unknown for files with empty name", () => {
      expect(File.getMediaType("")).toBe(FileMediaType.unknown);
    });

    it("should handle filename with multiple dots", () => {
      expect(File.getMediaType("my.photo.jpg")).toBe(FileMediaType.image);
      expect(File.getMediaType("archive.tar.gz")).toBe(FileMediaType.unknown);
    });
  });
});
