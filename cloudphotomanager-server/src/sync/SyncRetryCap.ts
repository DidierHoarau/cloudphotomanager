// Shared retry-cap constant: the queue fires the persistent-failure webhook
// at the transition (SyncQueue) and the cap itself gates auto re-queueing
// (SyncFileCache). Kept dependency-free so it can be imported from both
// sides of the SyncQueue/SyncFileCache import cycle without TDZ issues.
// The web mirrors this value in cloudphotomanager-web/utils/SyncHealth.ts.
export const SYNC_FAIL_MAX_AUTO_RETRY = 5;
