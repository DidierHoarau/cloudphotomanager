import { describe, expect, it } from "vitest";
import {
  countApplicableConflicts,
  isConflictApplicable,
} from "../utils/SyncFailureActions";

function conflictFailure(
  id: string,
  targetFileId: string | null,
): Record<string, unknown> {
  return {
    id,
    kind: "conflict",
    conflict: {
      sourceFileId: `source-${id}`,
      targetFileId,
      targetFolderpath: "/q",
      source: { filename: "source.jpg", folderpath: "/p" },
      target: { filename: "target.jpg", folderpath: "/q" },
    },
  };
}

function errorFailure(id: string): Record<string, unknown> {
  return { id, kind: "error", errorMessage: "boom" };
}

describe("isConflictApplicable", () => {
  it("accepts a conflict carrying both file ids for either action", () => {
    const failure = conflictFailure("f1", "target-1");
    expect(isConflictApplicable(failure, "replace")).toBe(true);
    expect(isConflictApplicable(failure, "deleteSource")).toBe(true);
  });

  it("rejects a conflict without a target file for replace only", () => {
    const failure = conflictFailure("f2", null);
    expect(isConflictApplicable(failure, "replace")).toBe(false);
    expect(isConflictApplicable(failure, "deleteSource")).toBe(true);
  });

  it("rejects plain errors and malformed conflicts", () => {
    expect(isConflictApplicable(errorFailure("f3"), "replace")).toBe(false);
    expect(isConflictApplicable(errorFailure("f3"), "deleteSource")).toBe(
      false,
    );
    expect(isConflictApplicable({ kind: "conflict" }, "replace")).toBe(false);
    expect(isConflictApplicable(null, "deleteSource")).toBe(false);
  });
});

describe("countApplicableConflicts", () => {
  it("counts only the conflicts the action applies to", () => {
    const failures = [
      conflictFailure("a", "target-a"),
      conflictFailure("b", null),
      errorFailure("c"),
    ];
    expect(countApplicableConflicts(failures, "replace")).toBe(1);
    expect(countApplicableConflicts(failures, "deleteSource")).toBe(2);
  });

  it("returns 0 for an empty or missing list", () => {
    expect(countApplicableConflicts([], "replace")).toBe(0);
    expect(
      countApplicableConflicts(undefined as any, "deleteSource"),
    ).toBe(0);
  });
});
