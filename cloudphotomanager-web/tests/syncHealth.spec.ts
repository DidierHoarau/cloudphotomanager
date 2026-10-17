import { describe, expect, it } from "vitest";
import {
  SYNC_FAIL_RETRY_CAP,
  isSyncBlocked,
  isSyncGone,
} from "../utils/SyncHealth";

describe("isSyncBlocked", () => {
  it("is false below the retry cap", () => {
    expect(isSyncBlocked({ syncFailCount: 0 })).toBe(false);
    expect(isSyncBlocked({ syncFailCount: 4 })).toBe(false);
  });

  it("is true at and above the retry cap", () => {
    expect(isSyncBlocked({ syncFailCount: SYNC_FAIL_RETRY_CAP })).toBe(true);
    expect(isSyncBlocked({ syncFailCount: 6 })).toBe(true);
  });

  it("treats a missing count as zero failures", () => {
    expect(isSyncBlocked({})).toBe(false);
    expect(isSyncBlocked(null)).toBe(false);
    expect(isSyncBlocked(undefined)).toBe(false);
  });
});

describe("isSyncGone", () => {
  it("is true when the tombstone is set", () => {
    expect(isSyncGone({ syncGone: 1 })).toBe(true);
    expect(isSyncGone({ syncGone: true })).toBe(true);
  });

  it("is false without a tombstone", () => {
    expect(isSyncGone({ syncGone: 0 })).toBe(false);
    expect(isSyncGone({})).toBe(false);
    expect(isSyncGone(null)).toBe(false);
    expect(isSyncGone(undefined)).toBe(false);
  });
});
