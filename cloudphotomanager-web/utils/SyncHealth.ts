// Sync health helpers for a file row as delivered by the API (File model
// carries syncFailCount / lastSyncError / syncGone).
// Keep SYNC_FAIL_RETRY_CAP in sync with the server constant
// SYNC_FAIL_MAX_AUTO_RETRY (cloudphotomanager-server/src/sync/SyncRetryCap.ts).
export const SYNC_FAIL_RETRY_CAP = 5;

export interface SyncHealthFile {
  syncFailCount?: number;
  syncGone?: number | boolean;
}

// A file at the retry cap will not be retried by the server until a manual
// retry or a cache rebuild resets the counter: its preview stays unavailable.
export function isSyncBlocked(file: SyncHealthFile | null | undefined): boolean {
  return (file?.syncFailCount ?? 0) >= SYNC_FAIL_RETRY_CAP;
}

// Tombstoned as missing in the cloud: not retried until a folder re-sync
// finds it again.
export function isSyncGone(file: SyncHealthFile | null | undefined): boolean {
  return !!file?.syncGone;
}
