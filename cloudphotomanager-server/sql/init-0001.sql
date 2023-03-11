CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    passwordEncrypted VARCHAR(500) NOT NULL
);

CREATE TABLE IF NOT EXISTS users_permissions (
    id VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    info TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    info TEXT NOT NULL,
    infoPrivate TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(50) NOT NULL,
    accountId VARCHAR(50) NOT NULL,
    filepath TEXT NOT NULL,
    name VARCHAR(200) NOT NULL,
    info TEXT NOT NULL
);
