import { describe, expect, it } from "vitest";
import {
  SYNC_FAIL_RETRY_CAP,
  canRetryEnrichment,
  enrichmentErrorText,
  enrichmentHasFailure,
  enrichmentStatusLabel,
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

describe("enrichment health", () => {
  it("does not mark a file as blocked or gone for an enrichment failure", () => {
    const file = {
      syncFailCount: 0,
      enrichmentStatus: "failed",
      lastEnrichmentError: "Unauthorized access to file",
    };
    expect(isSyncBlocked(file)).toBe(false);
    expect(isSyncGone(file)).toBe(false);
  });

  it("detects only the failed enrichment status", () => {
    expect(enrichmentHasFailure({ enrichmentStatus: "failed" })).toBe(true);
    expect(enrichmentHasFailure({ enrichmentStatus: "ok" })).toBe(false);
    expect(enrichmentHasFailure({ enrichmentStatus: "pending" })).toBe(false);
    expect(enrichmentHasFailure({ enrichmentStatus: "disabled" })).toBe(false);
    expect(enrichmentHasFailure(null)).toBe(false);
    expect(enrichmentHasFailure({})).toBe(false);
  });

  it("labels every enrichment state for operators", () => {
    expect(enrichmentStatusLabel({ enrichmentStatus: "ok" })).toMatch(
      /generated/i,
    );
    expect(enrichmentStatusLabel({ enrichmentStatus: "failed" })).toMatch(
      /failed/i,
    );
    expect(enrichmentStatusLabel({ enrichmentStatus: "pending" })).toMatch(
      /pending/i,
    );
    expect(enrichmentStatusLabel({ enrichmentStatus: "disabled" })).toMatch(
      /disabled/i,
    );
    expect(enrichmentStatusLabel({})).toMatch(/not generated/i);
  });

  it("surfaces the real cause recorded by the server", () => {
    expect(
      enrichmentErrorText({ lastEnrichmentError: "Model download timed out" }),
    ).toBe("Model download timed out");
    expect(enrichmentErrorText({ lastEnrichmentError: "   " })).toBeNull();
    expect(enrichmentErrorText({})).toBeNull();
    expect(enrichmentErrorText(null)).toBeNull();
  });

  it("only offers a retry for failed enrichment while online", () => {
    expect(canRetryEnrichment({ enrichmentStatus: "failed" }, true)).toBe(true);
    expect(canRetryEnrichment({ enrichmentStatus: "failed" }, false)).toBe(
      false,
    );
    expect(canRetryEnrichment({ enrichmentStatus: "ok" }, true)).toBe(false);
    expect(canRetryEnrichment({ enrichmentStatus: "pending" }, true)).toBe(
      false,
    );
    expect(canRetryEnrichment(null, true)).toBe(false);
  });
});
