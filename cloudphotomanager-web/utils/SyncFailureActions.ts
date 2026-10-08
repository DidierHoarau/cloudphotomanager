export type ConflictResolveAction = "replace" | "deleteSource";

// A conflict failure can be resolved with `action` only when it is a conflict
// and carries the file id that action needs: the target file for "replace",
// the source file for "deleteSource". Plain errors and conflicts missing the
// id (e.g. records written before the target was resolved) never apply.
export function isConflictApplicable(
  failure: any,
  action: ConflictResolveAction,
): boolean {
  const conflict = failure && failure.conflict;
  if (!failure || failure.kind !== "conflict" || !conflict) {
    return false;
  }
  if (action === "replace") {
    return !!conflict.targetFileId;
  }
  return !!conflict.sourceFileId;
}

export function countApplicableConflicts(
  failures: any[],
  action: ConflictResolveAction,
): number {
  let count = 0;
  for (const failure of failures || []) {
    if (isConflictApplicable(failure, action)) {
      count++;
    }
  }
  return count;
}
