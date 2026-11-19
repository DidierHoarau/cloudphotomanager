-- Reverse-geocoded place on files (country, region, city), resolved locally
-- from the bundled GeoNames-derived dataset. placeStatus tracks progress so
-- the backfill never re-processes a row:
--   NULL = not attempted yet
--   'ok' = a populated place was found and stored
--   'none' = geocoded but no populated place within the distance threshold
--            (oceans, deserts, polar regions)
ALTER TABLE files ADD COLUMN placeCountry VARCHAR(100);
ALTER TABLE files ADD COLUMN placeCountryCode VARCHAR(10);
ALTER TABLE files ADD COLUMN placeRegion VARCHAR(150);
ALTER TABLE files ADD COLUMN placeCity VARCHAR(150);
ALTER TABLE files ADD COLUMN placeStatus VARCHAR(10);

CREATE INDEX IF NOT EXISTS files_accountId_placeStatus
  ON files(accountId, placeStatus);
CREATE INDEX IF NOT EXISTS files_accountId_place
  ON files(accountId, placeCountry, placeRegion, placeCity);
