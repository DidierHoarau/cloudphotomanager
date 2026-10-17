// Translates recurring technical sync errors into a plain-language cause and
// a user-actionable suggestion. Unmatched errors return null so the UI keeps
// showing the raw message instead of a wrong explanation.
export interface SyncErrorHumanCause {
  cause: string;
  action: string;
}

interface CatalogEntry {
  pattern: RegExp;
  cause: string;
  action: string;
}

const CATALOG: CatalogEntry[] = [
  {
    pattern: /Error getting Video Width|syncVideoFromFull\s*Failed|Generated file empty/i,
    cause:
      "Video preview could not be generated — the file may be unsupported or corrupt",
    action:
      "Open the file's info to rebuild its cache, or dismiss the failure if the file is known-bad",
  },
  {
    pattern: /VipsJpeg|Corrupt JPEG|premature end/i,
    cause: "Image appears to be corrupt or truncated",
    action:
      "Re-download the original from the source, then rebuild the file's cache; dismiss the failure if the file is known-bad",
  },
  {
    pattern: /ENOENT/i,
    cause: "Temporary cache file disappeared mid-processing",
    action: "Retry the operation",
  },
  {
    pattern: /401|403|Unauthorized|AccessDenied/i,
    cause: "Storage account authentication failed",
    action: "Re-authorize the account in Settings → Accounts",
  },
  {
    pattern: /404|ItemNotFound/i,
    cause: "File no longer exists in the cloud storage",
    action:
      "Dismiss the failure; the next folder sync will reconcile the library",
  },
  {
    pattern: /406|416/i,
    cause: "Cloud thumbnail service rejected this item",
    action: "Retry the operation; a local fallback is attempted automatically",
  },
  {
    pattern: /timeout|timed out/i,
    cause: "The operation took too long and was aborted",
    action: "Retry the operation",
  },
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i,
    cause: "Could not reach the storage provider",
    action: "Check network connectivity, then retry the operation",
  },
  {
    // Last resort: the generic "sync<Op> Failed" wrapper thrown by the
    // file-cache handlers when no more specific cause matched above.
    pattern: /sync\w*\s*Failed/i,
    cause:
      "The file could not be processed — it may be unsupported or its cache is out of date",
    action:
      "Retry the operation or rebuild the file's cache; dismiss the failure if the file is known-bad",
  },
];

export function SyncErrorDescribeHumanCause(
  errorMessage: string | undefined,
  _functionName: string,
): SyncErrorHumanCause | null {
  if (!errorMessage) {
    return null;
  }
  for (const entry of CATALOG) {
    if (entry.pattern.test(errorMessage)) {
      return { cause: entry.cause, action: entry.action };
    }
  }
  return null;
}
