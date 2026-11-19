import { describe, expect, it } from "vitest";
import {
  buildDuplicateTrashSummary,
  duplicateCaptureTime,
  duplicateFileSize,
  duplicateFolderDepth,
  duplicatePixelCount,
  duplicateRemovalIds,
  resolveDuplicateKeep,
  suggestDuplicateKeep,
} from "../utils/DuplicateReview";

interface MakeFileOptions {
  id: string;
  filename?: string;
  folderId?: string;
  width?: number;
  height?: number;
  size?: number;
  dateMedia?: string | number | Date | null;
  takenDateTime?: string;
}

function makeFile(options: MakeFileOptions): any {
  const metadata: any = {};
  if (options.width !== undefined && options.height !== undefined) {
    metadata.image = { width: options.width, height: options.height };
  }
  if (options.takenDateTime !== undefined) {
    metadata.photo = { takenDateTime: options.takenDateTime };
  }
  return {
    id: options.id,
    filename: options.filename ?? `${options.id}.jpg`,
    folderId: options.folderId ?? "folder-1",
    dateMedia: options.dateMedia ?? null,
    info: options.size !== undefined ? { size: options.size } : {},
    metadata,
  };
}

describe("duplicate metrics", () => {
  it("returns the largest area across media descriptors", () => {
    expect(
      duplicatePixelCount(
        makeFile({ id: "a", width: 100, height: 100 }),
      ),
    ).toBe(10000);
    const mixed: any = {
      id: "b",
      metadata: {
        image: { width: 100, height: 100 },
        video: { width: 1920, height: 1080 },
        photo: { width: 10, height: 10 },
      },
    };
    expect(duplicatePixelCount(mixed)).toBe(1920 * 1080);
  });

  it("treats missing or invalid dimensions as zero", () => {
    expect(duplicatePixelCount(makeFile({ id: "a" }))).toBe(0);
    expect(
      duplicatePixelCount({
        id: "b",
        metadata: { image: { width: "x", height: 10 } },
      }),
    ).toBe(0);
    expect(duplicatePixelCount({ id: "c" })).toBe(0);
  });

  it("parses the file size and falls back to zero", () => {
    expect(duplicateFileSize(makeFile({ id: "a", size: 1234 }))).toBe(1234);
    expect(
      duplicateFileSize({ id: "b", info: { size: "2048" } }),
    ).toBe(2048);
    expect(duplicateFileSize(makeFile({ id: "c" }))).toBe(0);
    expect(duplicateFileSize({ id: "d", info: { size: "nope" } })).toBe(0);
  });

  it("prefers the EXIF capture date and treats the 1970 epoch as unknown", () => {
    expect(
      duplicateCaptureTime({
        id: "a",
        dateMedia: "2021-05-01T00:00:00.000Z",
        metadata: { photo: { takenDateTime: "2020-01-02T00:00:00.000Z" } },
      }),
    ).toBe(Date.parse("2020-01-02T00:00:00.000Z"));
    expect(
      duplicateCaptureTime({ id: "b", dateMedia: "1970-01-01T00:00:00.000Z" }),
    ).toBeNull();
    expect(duplicateCaptureTime({ id: "c", dateMedia: 0 })).toBeNull();
    expect(duplicateCaptureTime({ id: "d", dateMedia: null })).toBeNull();
    expect(duplicateCaptureTime({ id: "e" })).toBeNull();
    expect(duplicateCaptureTime({ id: "f", dateMedia: "not-a-date" })).toBeNull();
  });

  it("counts folder depth with a missing path ranked last", () => {
    expect(duplicateFolderDepth("/")).toBe(0);
    expect(duplicateFolderDepth("/a")).toBe(1);
    expect(duplicateFolderDepth("/a/b")).toBe(2);
    expect(duplicateFolderDepth("a/b/c")).toBe(3);
    expect(duplicateFolderDepth("//a//b/")).toBe(2);
    expect(duplicateFolderDepth("")).toBe(Infinity);
    expect(duplicateFolderDepth(undefined)).toBe(Infinity);
    expect(duplicateFolderDepth(null)).toBe(Infinity);
  });
});

describe("suggestDuplicateKeep", () => {
  it("prefers the highest resolution even when the file is smaller", () => {
    const highRes = makeFile({ id: "hi", width: 4032, height: 3024, size: 1000 });
    const bigFile = makeFile({ id: "big", width: 100, height: 100, size: 9000 });
    const result = suggestDuplicateKeep([bigFile, highRes]);
    expect(result.keepId).toBe("hi");
    expect(result.reason).toBe("Highest resolution (4032×3024)");
  });

  it("uses the file size when dimensions are missing", () => {
    const bigger = makeFile({ id: "big", size: 5000 });
    const smaller = makeFile({ id: "small", size: 1000 });
    const result = suggestDuplicateKeep([smaller, bigger]);
    expect(result.keepId).toBe("big");
    expect(result.reason).toBe("Largest file");
  });

  it("keeps the earliest capture and ranks unknown or 1970 dates last", () => {
    const earliest = makeFile({ id: "early", dateMedia: "2020-01-01T00:00:00Z" });
    const later = makeFile({ id: "late", dateMedia: "2021-01-01T00:00:00Z" });
    const unknown = makeFile({ id: "unknown", dateMedia: null });
    const epoch = makeFile({ id: "epoch", dateMedia: "1970-01-01T00:00:00Z" });
    const result = suggestDuplicateKeep([later, epoch, earliest, unknown]);
    expect(result.keepId).toBe("early");
    expect(result.reason).toBe("Earliest capture date");
    // Unknown dates lose to any known date.
    expect(suggestDuplicateKeep([unknown, epoch, later]).keepId).toBe("late");
  });

  it("prefers the shallowest folder", () => {
    const deep = makeFile({ id: "deep", folderId: "deep" });
    const shallow = makeFile({ id: "shallow", folderId: "shallow" });
    const result = suggestDuplicateKeep([deep, shallow], {
      deep: "/a/b/c",
      shallow: "/a",
    });
    expect(result.keepId).toBe("shallow");
    expect(result.reason).toBe("Shallowest folder");
  });

  it("prefers a clean filename over a copy marker", () => {
    const copy = makeFile({
      id: "copy",
      filename: "beach copy (1).jpg",
      size: 1000,
    });
    const clean = makeFile({ id: "clean", filename: "beach.jpg", size: 1000 });
    const result = suggestDuplicateKeep([copy, clean]);
    expect(result.keepId).toBe("clean");
    expect(result.reason).toBe("Cleanest filename");
  });

  it("breaks a full tie with the lower id", () => {
    const result = suggestDuplicateKeep([
      makeFile({ id: "b" }),
      makeFile({ id: "a" }),
    ]);
    expect(result.keepId).toBe("a");
    expect(result.reason).toBe("Tie-break");
  });

  it("returns no keep for an empty group", () => {
    expect(suggestDuplicateKeep([])).toEqual({
      keepId: null,
      reason: "Tie-break",
    });
  });
});

describe("resolveDuplicateKeep", () => {
  const suggested = makeFile({ id: "hi", width: 4000, height: 3000 });
  const other = makeFile({ id: "lo", width: 100, height: 100 });
  const group = { hash: "h1", files: [suggested, other] };

  it("honours a manual keep that belongs to the group", () => {
    const resolution = resolveDuplicateKeep(group, { h1: "lo" });
    expect(resolution.keepId).toBe("lo");
    expect(resolution.suggestedKeepId).toBe("hi");
    expect(resolution.isOverride).toBe(true);
  });

  it("falls back to the suggestion for an invalid override", () => {
    const resolution = resolveDuplicateKeep(group, { h1: "missing" });
    expect(resolution.keepId).toBe("hi");
    expect(resolution.isOverride).toBe(false);
    expect(resolveDuplicateKeep(group, null).keepId).toBe("hi");
  });

  it("accepts a Map of overrides", () => {
    const map = new Map([["h1", "lo"]]);
    expect(resolveDuplicateKeep(group, map).keepId).toBe("lo");
  });
});

describe("duplicateRemovalIds", () => {
  it("returns every copy except the keep of a two-copy group", () => {
    const group = {
      hash: "h1",
      files: [
        makeFile({ id: "a", width: 4000, height: 3000 }),
        makeFile({ id: "b", width: 100, height: 100 }),
      ],
    };
    expect(duplicateRemovalIds([group], null)).toEqual(["b"]);
  });

  it("returns the two non-kept copies of a three-copy group with an override", () => {
    const group = {
      hash: "h1",
      files: [
        makeFile({ id: "a", width: 4000, height: 3000 }),
        makeFile({ id: "b", width: 100, height: 100 }),
        makeFile({ id: "c", width: 100, height: 100 }),
      ],
    };
    expect(duplicateRemovalIds([group], { h1: "b" }).sort()).toEqual([
      "a",
      "c",
    ]);
  });

  it("de-duplicates ids across groups", () => {
    const shared = makeFile({ id: "shared", width: 4000, height: 3000 });
    const groups = [
      { hash: "h1", files: [shared, makeFile({ id: "x" })] },
      { hash: "h2", files: [shared, makeFile({ id: "y" })] },
    ];
    expect(duplicateRemovalIds(groups, null).sort()).toEqual(["x", "y"]);
  });
});

describe("buildDuplicateTrashSummary", () => {
  const folderPaths = new Map([
    ["d1", "/2020"],
    ["d2", "/2021"],
  ]);
  const groups = [
    {
      hash: "h1",
      files: [
        makeFile({ id: "a1", filename: "a1.jpg", folderId: "d1", width: 4000, height: 3000 }),
        makeFile({ id: "a2", filename: "a2.jpg", folderId: "d1", width: 100, height: 100 }),
      ],
    },
    {
      hash: "h2",
      files: [
        makeFile({ id: "b1", filename: "b1.jpg", folderId: "d2", width: 4000, height: 3000 }),
        makeFile({ id: "b2", filename: "b2.jpg", folderId: "d1", width: 100, height: 100 }),
        makeFile({ id: "b3", filename: "b3.jpg", folderId: "d2", width: 100, height: 100 }),
      ],
    },
  ];

  it("counts groups and files and lists the removed paths", () => {
    const summary = buildDuplicateTrashSummary(groups, null, folderPaths);
    expect(summary.groupCount).toBe(2);
    expect(summary.fileCount).toBe(3);
    expect(summary.lines).toEqual([
      "/2020/a2.jpg",
      "/2020/b2.jpg",
      "/2021/b3.jpg",
    ]);
    expect(summary.truncated).toBe(false);
    expect(summary.remaining).toBe(0);
  });

  it("truncates long path lists and reports the remainder", () => {
    const summary = buildDuplicateTrashSummary(groups, null, folderPaths, 1);
    expect(summary.fileCount).toBe(3);
    expect(summary.lines).toEqual(["/2020/a2.jpg"]);
    expect(summary.truncated).toBe(true);
    expect(summary.remaining).toBe(2);
  });

  it("falls back to the filename when the folder path is unknown", () => {
    const summary = buildDuplicateTrashSummary(
      [
        {
          hash: "h1",
          files: [
            makeFile({ id: "a1", filename: "a1.jpg", width: 4000, height: 3000 }),
            makeFile({ id: "a2", filename: "a2.jpg", width: 100, height: 100 }),
          ],
        },
      ],
      null,
      null,
    );
    expect(summary.lines).toEqual(["a2.jpg"]);
  });

  it("is empty for empty selection", () => {
    expect(buildDuplicateTrashSummary([], null, folderPaths)).toEqual({
      groupCount: 0,
      fileCount: 0,
      lines: [],
      truncated: false,
      remaining: 0,
    });
  });
});
