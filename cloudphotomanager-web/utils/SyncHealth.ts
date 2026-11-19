// Sync health helpers for a file row as delivered by the API (File model
// carries syncFailCount / lastSyncError / syncGone, plus the dedicated
// best-effort enrichment state).
// Keep SYNC_FAIL_RETRY_CAP in sync with the server constant
// SYNC_FAIL_MAX_AUTO_RETRY (cloudphotomanager-server/src/sync/SyncRetryCap.ts).
export const SYNC_FAIL_RETRY_CAP = 5;

export interface SyncHealthFile {
  syncFailCount?: number;
  syncGone?: number | boolean;
}

export interface EnrichmentHealthFile {
  enrichmentStatus?: string | null;
  lastEnrichmentError?: string | null;
  enrichmentFailCount?: number;
}

// A file at the retry cap will not be retried by the server until a manual
// retry or a cache rebuild resets the counter: its preview stays unavailable.
// Enrichment (keyword/label) failures are tracked separately and must never
// mark a file as blocked or corrupt.
export function isSyncBlocked(file: SyncHealthFile | null | undefined): boolean {
  return (file?.syncFailCount ?? 0) >= SYNC_FAIL_RETRY_CAP;
}

// Tombstoned as missing in the cloud: not retried until a folder re-sync
// finds it again.
export function isSyncGone(file: SyncHealthFile | null | undefined): boolean {
  return !!file?.syncGone;
}

// Best-effort label enrichment state: "ok" | "failed" | "pending" |
// "disabled" | null when never attempted (e.g. videos).
export function enrichmentHasFailure(
  file: EnrichmentHealthFile | null | undefined,
): boolean {
  return file?.enrichmentStatus === "failed";
}

export function enrichmentStatusLabel(
  file: EnrichmentHealthFile | null | undefined,
): string {
  switch (file?.enrichmentStatus) {
    case "ok":
      return "Labels generated";
    case "failed":
      return "Label enrichment failed";
    case "pending":
      return "Labels pending";
    case "disabled":
      return "Label enrichment disabled";
    default:
      return "Labels not generated";
  }
}

// The real cause recorded by the server, or null when there is none to show.
export function enrichmentErrorText(
  file: EnrichmentHealthFile | null | undefined,
): string | null {
  const error = file?.lastEnrichmentError;
  return error && error.trim().length > 0 ? error : null;
}

// Retrying only makes sense for a failed enrichment and, on the client, when
// the browser is online (the request itself needs the network).
export function canRetryEnrichment(
  file: EnrichmentHealthFile | null | undefined,
  isOnline = true,
): boolean {
  return isOnline && enrichmentHasFailure(file);
}
