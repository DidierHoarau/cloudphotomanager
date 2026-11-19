-- Keyword/label enrichment (image classification) becomes best-effort and is
-- tracked separately from the media-critical sync state, so an enrichment
-- outage never blocks previews, filename search or the poison-file retry cap.

ALTER TABLE files ADD COLUMN enrichmentStatus TEXT;
ALTER TABLE files ADD COLUMN lastEnrichmentError TEXT;
ALTER TABLE files ADD COLUMN lastEnrichmentAttempt TEXT;
ALTER TABLE files ADD COLUMN enrichmentFailCount INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS files_enrichmentStatus
  ON files(enrichmentStatus);
CREATE INDEX IF NOT EXISTS files_accountId_enrichmentStatus
  ON files(accountId, enrichmentStatus);

-- Legacy repair: before this migration syncPhotoKeyWords recorded its failures
-- as media failures (syncFailCount / lastSyncError) and never persisted the
-- filename keywords. Move that history onto the dedicated enrichment columns
-- and clear the media counters so previously blocked files are viewable again
-- and are not left at the retry cap.
UPDATE files
SET enrichmentStatus = 'failed',
    lastEnrichmentError = lastSyncError,
    lastEnrichmentAttempt = lastSyncAttempt,
    enrichmentFailCount = COALESCE(syncFailCount, 1),
    syncFailCount = 0,
    lastSyncError = NULL,
    lastSyncAttempt = NULL
WHERE lastSyncError LIKE '%syncPhotoKeyWords%';

-- Rows that already have keywords were enriched successfully.
UPDATE files
SET enrichmentStatus = 'ok'
WHERE enrichmentStatus IS NULL AND keywords IS NOT NULL AND keywords <> '';

-- Images whose keywords are missing still need classification: mark them
-- pending before backfilling the filename so the daily check re-queues them.
UPDATE files
SET enrichmentStatus = 'pending'
WHERE enrichmentStatus IS NULL
  AND (keywords IS NULL OR keywords = '')
  AND (
    LOWER(filename) LIKE '%.jpg' OR LOWER(filename) LIKE '%.jpeg' OR
    LOWER(filename) LIKE '%.png' OR LOWER(filename) LIKE '%.gif' OR
    LOWER(filename) LIKE '%.webp' OR LOWER(filename) LIKE '%.tiff' OR
    LOWER(filename) LIKE '%.dng' OR LOWER(filename) LIKE '%.raw' OR
    LOWER(filename) LIKE '%.arw' OR LOWER(filename) LIKE '%.heic'
  );

-- Backfill filename keywords immediately: filename search must survive a
-- classification outage until the enrichment retry runs.
UPDATE files
SET keywords = LOWER(filename)
WHERE (keywords IS NULL OR keywords = '')
  AND (
    LOWER(filename) LIKE '%.jpg' OR LOWER(filename) LIKE '%.jpeg' OR
    LOWER(filename) LIKE '%.png' OR LOWER(filename) LIKE '%.gif' OR
    LOWER(filename) LIKE '%.webp' OR LOWER(filename) LIKE '%.tiff' OR
    LOWER(filename) LIKE '%.dng' OR LOWER(filename) LIKE '%.raw' OR
    LOWER(filename) LIKE '%.arw' OR LOWER(filename) LIKE '%.heic'
  );
