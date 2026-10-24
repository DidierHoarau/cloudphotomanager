-- One canonical folder row per (accountId, folderpath). Duplicates can only
-- come from legacy/manual data (folders.id is UNIQUE and path-derived), but the
-- previous cleanup deleted every row of a duplicate group, orphaning files.
-- Repoint files, shares and permission grants onto the canonical row (lowest
-- rowid), then prevent new duplicates with a unique index.

DROP TABLE IF EXISTS _folder_canonical;
DROP TABLE IF EXISTS _folder_duplicates;

CREATE TEMP TABLE _folder_canonical AS
  SELECT accountId, folderpath, MIN(rowid) AS canonicalRowid
  FROM folders
  GROUP BY accountId, folderpath;

CREATE TEMP TABLE _folder_duplicates AS
  SELECT f.id AS oldId, c.id AS canonicalId
  FROM folders f
  JOIN _folder_canonical k
    ON k.accountId = f.accountId AND k.folderpath = f.folderpath
  JOIN folders c ON c.rowid = k.canonicalRowid
  WHERE f.rowid <> k.canonicalRowid;

UPDATE files
SET folderId = (SELECT canonicalId FROM _folder_duplicates WHERE oldId = files.folderId)
WHERE folderId IN (SELECT oldId FROM _folder_duplicates);

UPDATE shares
SET folderId = (SELECT canonicalId FROM _folder_duplicates WHERE oldId = shares.folderId)
WHERE folderId IN (SELECT oldId FROM _folder_duplicates);

UPDATE users_permissions
SET info = json_set(info, '$.folders', (
  SELECT json_group_array(
    json_set(je.value, '$.folderId',
      CASE
        WHEN EXISTS (
          SELECT 1 FROM _folder_duplicates d
          WHERE d.oldId = json_extract(je.value, '$.folderId')
        )
        THEN (SELECT d.canonicalId FROM _folder_duplicates d
              WHERE d.oldId = json_extract(je.value, '$.folderId'))
        ELSE json_extract(je.value, '$.folderId')
      END
    )
  )
  FROM json_each(json_extract(users_permissions.info, '$.folders')) AS je
))
WHERE EXISTS (
  SELECT 1 FROM json_each(json_extract(users_permissions.info, '$.folders')) AS je
  WHERE json_extract(je.value, '$.folderId') IN (SELECT oldId FROM _folder_duplicates)
);

DELETE FROM folders WHERE id IN (SELECT oldId FROM _folder_duplicates);

DROP TABLE _folder_duplicates;
DROP TABLE _folder_canonical;

-- The unique index replaces the non-unique (accountId, folderpath) index.
DROP INDEX IF EXISTS folders_accountId_folderpath;
CREATE UNIQUE INDEX IF NOT EXISTS folders_accountId_folderpath_unique
  ON folders(accountId, folderpath);
