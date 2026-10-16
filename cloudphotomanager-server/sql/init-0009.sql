-- Favorites and trash (soft delete) state on files. Trash is DB-only: the
-- file stays in the cloud storage account, so folder syncs keep the row and
-- a restore is possible until the retention purge permanently deletes it.
ALTER TABLE files ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN dateTrashed VARCHAR(100);
CREATE INDEX IF NOT EXISTS files_accountId_trashed_dateMedia_id ON files(accountId, trashed, dateMedia, id);
CREATE INDEX IF NOT EXISTS files_trashed_dateTrashed ON files(trashed, dateTrashed);
