CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    passwordEncrypted VARCHAR(500) NOT NULL
);

CREATE TABLE IF NOT EXISTS users_permissions (
    id VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    info TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(5000) NOT NULL,
    rootpath VARCHAR(5000) NOT NULL,
    info TEXT NOT NULL,
    infoPrivate TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id VARCHAR(50) NOT NULL,
    idCloud VARCHAR(5000) NOT NULL,
    accountId VARCHAR(50) NOT NULL,
    folderpath VARCHAR(5000) NOT NULL,
    dateSync VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    info TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(50) NOT NULL,
    idCloud VARCHAR(5000) NOT NULL,
    accountId VARCHAR(50) NOT NULL,
    folderId VARCHAR(50) NOT NULL,
    filename VARCHAR(5000) NOT NULL,
    dateSync VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    dateMedia VARCHAR(100),
    hash VARCHAR(500) NOT NULL,
    info TEXT NOT NULL,
    metadata TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS files_accountId ON files(accountId);
CREATE INDEX IF NOT EXISTS files_folderId ON files(folderId);

