-- Read-path performance indexes: duplicate analysis needs (accountId, hash)
-- lookups, the recursive browsing filter needs (accountId, folderpath), and
-- the per-account folder counts GROUP BY becomes index-only with
-- (accountId, folderId).
CREATE INDEX IF NOT EXISTS files_accountId_hash ON files(accountId, hash);
CREATE INDEX IF NOT EXISTS folders_accountId_folderpath ON folders(accountId, folderpath);
CREATE INDEX IF NOT EXISTS files_accountId_folderId ON files(accountId, folderId);
