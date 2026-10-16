-- Share links: read-only public access to a folder subtree via a token. Only
-- the sha256 hash of the token is stored, so a database leak does not reveal
-- usable URLs.
CREATE TABLE IF NOT EXISTS shares (
  id VARCHAR(300) UNIQUE NOT NULL,
  accountId VARCHAR(50) NOT NULL,
  folderId VARCHAR(50) NOT NULL,
  tokenHash VARCHAR(500) NOT NULL,
  dateCreated VARCHAR(100) NOT NULL,
  dateExpires VARCHAR(100),
  info TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_tokenHash ON shares(tokenHash);
