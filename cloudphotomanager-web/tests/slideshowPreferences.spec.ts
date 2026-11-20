import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesSlideshow } from "../services/PreferencesSlideshow";

function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreferencesSlideshow", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(PreferencesSlideshow.getOptions()).toEqual({
      interval: 5,
      loop: true,
      shuffle: false,
    });
  });

  it("persists interval, loop and shuffle", () => {
    PreferencesSlideshow.setOptions({ interval: 15, loop: false, shuffle: true });
    expect(PreferencesSlideshow.getOptions()).toEqual({
      interval: 15,
      loop: false,
      shuffle: true,
    });
  });

  it("falls back to the defaults on malformed JSON", () => {
    localStorage.setItem("slideshowOptions", "{not-json");
    expect(PreferencesSlideshow.getOptions()).toEqual({
      interval: 5,
      loop: true,
      shuffle: false,
    });
  });

  it("normalizes a stored interval", () => {
    localStorage.setItem(
      "slideshowOptions",
      JSON.stringify({ interval: 12, loop: true, shuffle: false }),
    );
    expect(PreferencesSlideshow.getOptions().interval).toBe(10);
  });
});
