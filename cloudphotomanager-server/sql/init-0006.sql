-- Deterministic pagination indexes: pages are ordered by
-- (dateMedia, id), so cover the ordering columns per lookup scope.
CREATE INDEX IF NOT EXISTS files_folderId_dateMedia_id ON files(folderId, dateMedia, id);
CREATE INDEX IF NOT EXISTS files_accountId_dateMedia_id ON files(accountId, dateMedia, id);
