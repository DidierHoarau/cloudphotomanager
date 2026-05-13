import * as fs from "fs-extra";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger } from "../OTelContext";

const FAILURES_FILE_PATH = path.join(
  process.env.DATA_DIR || "/data",
  "sync-failures.json",
);
const MAX_FAILURES = 500;
const MAX_AGE_MS = 24 * 3600 * 1000;
const WRITE_DEBOUNCE_MS = 300;

const logger = OTelLogger().createModuleLogger("SyncFailures");

// Conflict types and MoveConflictError live in SyncMoveConflict.ts (the
// detector module). Re-exported here so existing callers keep working.
export {
  MoveConflictError,
  SyncFailureConflict,
  SyncFailureConflictSnapshot,
} from "./SyncMoveConflict";
import { SyncFailureConflict } from "./SyncMoveConflict";

export interface SyncFailure {
  id: string;
  accountId: string;
  functionName: string;
  kind: "conflict" | "error";
  priority: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  fileIds: string[];
  errorMessage?: string;
  dateCreated: string;
  conflict?: SyncFailureConflict;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BroadcastFn = (message: any) => void;
let broadcastFn: BroadcastFn | null = null;

let failures: SyncFailure[] = [];
let writeTimer: NodeJS.Timeout | null = null;
let writePending = false;

export async function SyncFailuresInit(_context: Span): Promise<void> {
  try {
    if (await fs.pathExists(FAILURES_FILE_PATH)) {
      const raw = await fs.readJSON(FAILURES_FILE_PATH);
      if (Array.isArray(raw)) {
        failures = raw.filter(
          (f) => f && typeof f === "object" && typeof f.id === "string",
        );
      }
    }
  } catch (err) {
    logger.error("Error loading sync-failures.json", err);
    failures = [];
  }
  prune();
  scheduleWrite();
}

export function SyncFailuresRegisterBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export function SyncFailuresList(): SyncFailure[] {
  prune();
  // Newest first
  return [...failures].sort((a, b) =>
    a.dateCreated < b.dateCreated ? 1 : a.dateCreated > b.dateCreated ? -1 : 0,
  );
}

export function SyncFailuresGetCount(): number {
  prune();
  return failures.length;
}

export function SyncFailuresGet(id: string): SyncFailure | null {
  return failures.find((f) => f.id === id) || null;
}

export function SyncFailuresAdd(
  failure: Omit<SyncFailure, "id" | "dateCreated"> &
    Partial<Pick<SyncFailure, "id" | "dateCreated">>,
): SyncFailure {
  const created: SyncFailure = {
    id: failure.id || uuidv4(),
    accountId: failure.accountId,
    functionName: failure.functionName,
    kind: failure.kind,
    priority: failure.priority,
    data: failure.data,
    fileIds: failure.fileIds || [],
    errorMessage: failure.errorMessage,
    dateCreated: failure.dateCreated || new Date().toISOString(),
    conflict: failure.conflict,
  };
  failures.push(created);
  prune();
  scheduleWrite();
  emitBroadcast();
  return created;
}

export function SyncFailuresRemove(id: string): boolean {
  const before = failures.length;
  failures = failures.filter((f) => f.id !== id);
  const removed = failures.length !== before;
  if (removed) {
    scheduleWrite();
    emitBroadcast();
  }
  return removed;
}

export function SyncFailuresClearAll(): number {
  const count = failures.length;
  failures = [];
  if (count > 0) {
    scheduleWrite();
    emitBroadcast();
  }
  return count;
}

export function SyncFailuresEmit(): void {
  emitBroadcast();
}

// Private helpers

function prune(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  failures = failures.filter((f) => {
    const t = Date.parse(f.dateCreated);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (failures.length > MAX_FAILURES) {
    failures.sort((a, b) =>
      a.dateCreated < b.dateCreated
        ? 1
        : a.dateCreated > b.dateCreated
          ? -1
          : 0,
    );
    failures = failures.slice(0, MAX_FAILURES);
  }
}

function scheduleWrite(): void {
  if (writeTimer) {
    writePending = true;
    return;
  }
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    try {
      await fs.ensureDir(path.dirname(FAILURES_FILE_PATH));
      await fs.writeJSON(FAILURES_FILE_PATH, failures, { spaces: 2 });
    } catch (err) {
      logger.error("Error writing sync-failures.json", err);
    }
    if (writePending) {
      writePending = false;
      scheduleWrite();
    }
  }, WRITE_DEBOUNCE_MS);
}

function emitBroadcast(): void {
  if (!broadcastFn) return;
  broadcastFn({
    type: "failures_update",
    count: SyncFailuresGetCount(),
    items: SyncFailuresList(),
  });
}
