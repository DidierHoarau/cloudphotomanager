CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    functionName TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    fileIds TEXT,
    dateCreated TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_queue_status_priority ON sync_queue(status, priority, dateCreated);
CREATE INDEX IF NOT EXISTS sync_queue_status ON sync_queue(status);
