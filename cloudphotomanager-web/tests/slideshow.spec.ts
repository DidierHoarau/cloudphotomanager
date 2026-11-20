import { describe, expect, it } from "vitest";

import {
  buildSlideshowOrder,
  nextSlideshowPosition,
  normalizeSlideshowInterval,
  normalizeSlideshowOptions,
  previousSlideshowPosition,
  SLIDESHOW_DEFAULT_INTERVAL,
  slideshowSourceFiles,
} from "../utils/Slideshow";

const FILES = [
  { id: "a", filename: "a.jpg" },
  { id: "b", filename: "b.heic" },
  { id: "c", filename: "c.mp4" },
  { id: "out", filename: "a-outtake.jpg" },
  { id: "txt", filename: "notes.txt" },
  { id: "d", filename: "d.png" },
];

function seededRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe("normalizeSlideshowInterval", () => {
  it("returns the default for invalid values", () => {
    for (const value of [undefined, null, "abc", NaN, Infinity]) {
      expect(normalizeSlideshowInterval(value)).toBe(
        SLIDESHOW_DEFAULT_INTERVAL,
      );
    }
  });

  it("snaps to the nearest allowed interval", () => {
    expect(normalizeSlideshowInterval(7)).toBe(5);
    expect(normalizeSlideshowInterval(9)).toBe(10);
    expect(normalizeSlideshowInterval("15")).toBe(15);
    expect(normalizeSlideshowInterval(100)).toBe(30);
  });
});

describe("normalizeSlideshowOptions", () => {
  it("uses the documented defaults", () => {
    expect(normalizeSlideshowOptions(null)).toEqual({
      interval: 5,
      loop: true,
      shuffle: false,
    });
    expect(normalizeSlideshowOptions("garbage")).toEqual({
      interval: 5,
      loop: true,
      shuffle: false,
    });
  });

  it("keeps well-formed values and normalizes the interval", () => {
    expect(
      normalizeSlideshowOptions({ interval: 12, loop: false, shuffle: true }),
    ).toEqual({ interval: 10, loop: false, shuffle: true });
  });

  it("ignores malformed members", () => {
    expect(
      normalizeSlideshowOptions({ interval: "nope", loop: "yes", shuffle: 1 }),
    ).toEqual({ interval: 5, loop: true, shuffle: false });
  });
});

describe("buildSlideshowOrder", () => {
  it("keeps the file order and drops outtakes and unknown media", () => {
    expect(buildSlideshowOrder(FILES, false)).toEqual([0, 1, 2, 5]);
  });

  it("shuffles deterministically with an injected RNG", () => {
    const random = seededRandom([0.1, 0.9, 0.3, 0.7]);
    expect(buildSlideshowOrder(FILES, true, random)).toEqual([1, 5, 2, 0]);
  });

  it("handles missing input", () => {
    expect(buildSlideshowOrder(null as any, false)).toEqual([]);
  });
});

describe("nextSlideshowPosition / previousSlideshowPosition", () => {
  const order = [0, 2, 5];

  it("moves within the order", () => {
    expect(nextSlideshowPosition(order, 0, false)).toBe(2);
    expect(previousSlideshowPosition(order, 2, false)).toBe(0);
  });

  it("wraps only when looping", () => {
    expect(nextSlideshowPosition(order, 5, true)).toBe(0);
    expect(nextSlideshowPosition(order, 5, false)).toBeNull();
    expect(previousSlideshowPosition(order, 0, true)).toBe(5);
    expect(previousSlideshowPosition(order, 0, false)).toBeNull();
  });

  it("handles a current position absent from the order", () => {
    expect(nextSlideshowPosition(order, 1, false)).toBe(2);
    expect(previousSlideshowPosition(order, 1, false)).toBe(0);
    expect(nextSlideshowPosition(order, 9, true)).toBe(0);
    expect(nextSlideshowPosition(order, 9, false)).toBeNull();
    expect(previousSlideshowPosition(order, -1, false)).toBeNull();
  });

  it("returns null for an empty order", () => {
    expect(nextSlideshowPosition([], 0, true)).toBeNull();
    expect(previousSlideshowPosition([], 0, true)).toBeNull();
  });
});

describe("slideshowSourceFiles", () => {
  it("uses the selection when non-empty", () => {
    expect(
      slideshowSourceFiles(FILES, [FILES[0], FILES[5]]).map((f) => f.id),
    ).toEqual(["a", "d"]);
  });

  it("falls back to all files and always filters unplayable entries", () => {
    expect(slideshowSourceFiles(FILES, []).map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
