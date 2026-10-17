import { describe, expect, it } from "vitest";
import {
  SYNC_OPERATION_LABELS,
  syncOperationLabel,
} from "../utils/SyncOperationLabels";

describe("syncOperationLabel", () => {
  it("labels every known priority-1 operation", () => {
    for (const operationName of Object.keys(SYNC_OPERATION_LABELS)) {
      expect(syncOperationLabel(operationName)).toBe(
        SYNC_OPERATION_LABELS[operationName],
      );
      expect(syncOperationLabel(operationName)).not.toBe(
        "Operation complete",
      );
    }
  });

  it("falls back to a generic label for unknown operations", () => {
    expect(syncOperationLabel("someOtherOp")).toBe("Operation complete");
  });
});
