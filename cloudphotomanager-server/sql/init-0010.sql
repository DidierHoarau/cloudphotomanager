-- Session revocation version. Bumped on logout, password change, permission
-- change and user deletion so previously issued JWTs stop being accepted.
ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0;
