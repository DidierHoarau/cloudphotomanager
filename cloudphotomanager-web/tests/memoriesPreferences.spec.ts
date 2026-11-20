import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesMemories } from "../services/PreferencesMemories";

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

describe("PreferencesMemories", () => {
  it("is enabled by default", () => {
    expect(PreferencesMemories.isEnabled()).toBe(true);
  });

  it("persists disabling and enabling the feature", () => {
    PreferencesMemories.setEnabled(false);
    expect(PreferencesMemories.isEnabled()).toBe(false);
    PreferencesMemories.setEnabled(true);
    expect(PreferencesMemories.isEnabled()).toBe(true);
  });

  it("treats a corrupt value as enabled", () => {
    localStorage.setItem("preferences_memories_enabled", "banana");
    expect(PreferencesMemories.isEnabled()).toBe(true);
  });

  it("is enabled when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(PreferencesMemories.isEnabled()).toBe(true);
    expect(() => PreferencesMemories.setEnabled(false)).not.toThrow();
  });
});
