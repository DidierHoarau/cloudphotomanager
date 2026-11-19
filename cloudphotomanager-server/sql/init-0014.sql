-- Dismissed duplicate groups ("keep both / not duplicates"). An ignore is
-- account-level and keyed by the exact content hash, so ignored groups never
-- reappear in the duplicate list, badges or counts. Reversible from the
-- "Ignored groups" panel (the row is deleted on unignore) and pruned lazily
-- when the group no longer exists.

CREATE TABLE IF NOT EXISTS duplicate_ignores (
  accountId VARCHAR(50) NOT NULL,
  hash VARCHAR(500) NOT NULL,
  dateIgnored VARCHAR(100) NOT NULL,
  userId VARCHAR(50),
  -- { fileCount, filename, folderId } snapshot taken server-side for the UI.
  info TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (accountId, hash)
);

CREATE INDEX IF NOT EXISTS duplicate_ignores_accountId_dateIgnored
  ON duplicate_ignores(accountId, dateIgnored);
