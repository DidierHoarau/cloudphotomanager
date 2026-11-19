-- Cross-folder albums and scope-aware share links.
--
-- An album is an ordered collection of file ids independent of the folder
-- tree: curating a cross-folder set no longer requires moving files. Albums
-- belong to one account; folder grants still filter what a user sees inside
-- one.
--
-- Shares gain an explicit scope (folder subtree, album membership or a single
-- file) plus the same expiry/revoke semantics. The bearer token stays
-- hash-only at rest; `tokenMode='derived'` marks tokens re-derivable from the
-- share id (HMAC of the server key) so an admin can re-copy a link without
-- storing it in plaintext, while legacy rows keep `random` tokens.

CREATE TABLE IF NOT EXISTS albums (
  id VARCHAR(50) NOT NULL PRIMARY KEY,
  accountId VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  coverFileId VARCHAR(50),
  orderMode VARCHAR(20) NOT NULL DEFAULT 'capture', -- capture | manual
  ownerUserId VARCHAR(50),
  dateCreated VARCHAR(100) NOT NULL,
  dateUpdated VARCHAR(100) NOT NULL,
  info TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS albums_account ON albums(accountId, dateUpdated);

CREATE TABLE IF NOT EXISTS album_items (
  albumId VARCHAR(50) NOT NULL,
  fileId VARCHAR(50) NOT NULL,
  position INTEGER NOT NULL,
  dateAdded VARCHAR(100) NOT NULL,
  PRIMARY KEY (albumId, fileId)
);

CREATE INDEX IF NOT EXISTS album_items_album ON album_items(albumId, position);
CREATE INDEX IF NOT EXISTS album_items_file ON album_items(fileId);

ALTER TABLE shares ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'folder'; -- folder | album | file
ALTER TABLE shares ADD COLUMN albumId VARCHAR(50);
ALTER TABLE shares ADD COLUMN fileId VARCHAR(50);
ALTER TABLE shares ADD COLUMN lastAccessDate VARCHAR(100);
ALTER TABLE shares ADD COLUMN ownerUserId VARCHAR(50);
ALTER TABLE shares ADD COLUMN tokenMode VARCHAR(20) NOT NULL DEFAULT 'random'; -- random | derived

CREATE INDEX IF NOT EXISTS shares_account ON shares(accountId, dateCreated);
