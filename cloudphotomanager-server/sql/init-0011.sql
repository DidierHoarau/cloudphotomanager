-- Tracks when a queue item was actually dispatched (became ACTIVE), so the
-- stuck-item sweeper does not delete an item that merely waited a long time
-- in the queue before starting. Nullable: legacy ACTIVE rows fall back to
-- dateCreated in the sweeper query.
ALTER TABLE sync_queue ADD COLUMN dateStarted TEXT;

CREATE INDEX IF NOT EXISTS sync_queue_status_dateStarted
  ON sync_queue (status, dateStarted);
