import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { Folder } from "../model/Folder";
import { UtilsMd5 } from "../Utils";

describe("FolderData", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");
  const accountId = "account-folderdata-spec";

  let folderData: typeof import("./FolderData");

  async function createFolder(
    folderpath: string,
    dateUpdated = new Date(),
  ): Promise<Folder> {
    const folder = new Folder(accountId, folderpath);
    folder.idCloud = `/cloud${folderpath}`;
    folder.dateSync = new Date();
    folder.dateUpdated = dateUpdated;
    await folderData.FolderDataAdd(span, folder);
    return folder;
  }

  function insertFileRow(folderId: string, fileId: string): void {
    const now = new Date().toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        fileId,
        `cloud/${fileId}`,
        accountId,
        `${fileId}.jpg`,
        folderId,
        `hash-${fileId}`,
        now,
        now,
        now,
        "{}",
        "{}",
      ],
    );
  }

  function folderpaths(): string[] {
    return SqlDbUtilsQuerySQL(
      span,
      "SELECT folderpath FROM folders WHERE accountId = ? ORDER BY folderpath",
      [accountId],
    ).map((row: any) => row.folderpath);
  }

  function fileIds(): string[] {
    return SqlDbUtilsQuerySQL(
      span,
      "SELECT id FROM files WHERE accountId = ? ORDER BY id",
      [accountId],
    ).map((row: any) => row.id);
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-folders-spec-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("FolderData.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    folderData = await import("./FolderData");
  });

  it("FolderDataDeletePathRecursive deletes the exact path and its subtree only", async () => {
    const year2023 = await createFolder("/2023");
    const year2023Sub = await createFolder("/2023/sub");
    const backup = await createFolder("/2023-backup");
    const backupSub = await createFolder("/2023-backup/sub");
    const other = await createFolder("/other");
    insertFileRow(year2023.id, "f-2023");
    insertFileRow(year2023Sub.id, "f-2023-sub");
    insertFileRow(backup.id, "f-backup");
    insertFileRow(backupSub.id, "f-backup-sub");
    insertFileRow(other.id, "f-other");

    await folderData.FolderDataDeletePathRecursive(span, accountId, "/2023");

    expect(folderpaths()).toEqual([
      "/2023-backup",
      "/2023-backup/sub",
      "/other",
    ]);
    expect(fileIds()).toEqual(["f-backup", "f-backup-sub", "f-other"]);
    expect(year2023.id).toBeTruthy();
    expect(backup.id).toBeTruthy();
  });

  it("treats LIKE wildcards in folder paths as literals", async () => {
    // A fresh account so the assertions are self-contained.
    const wildcardAccountId = "account-folderdata-wildcards";
    const percentFolder = new Folder(wildcardAccountId, "/100%_real");
    percentFolder.idCloud = "/cloud/100%_real";
    percentFolder.dateSync = new Date();
    percentFolder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, percentFolder);
    const nearMatchFolder = new Folder(wildcardAccountId, "/100Xreal");
    nearMatchFolder.idCloud = "/cloud/100Xreal";
    nearMatchFolder.dateSync = new Date();
    nearMatchFolder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, nearMatchFolder);

    await folderData.FolderDataDeletePathRecursive(
      span,
      wildcardAccountId,
      "/100%_real",
    );

    // Without escaping, "%"_" would match "100Xreal" as well.
    const remaining = SqlDbUtilsQuerySQL(
      span,
      "SELECT folderpath FROM folders WHERE accountId = ? ORDER BY folderpath",
      [wildcardAccountId],
    ).map((row: any) => row.folderpath);
    expect(remaining).toEqual(["/100Xreal"]);
  });

  it("deletes every folder and file of the account for the root path", async () => {
    await folderData.FolderDataDeletePathRecursive(span, accountId, "/");
    expect(folderpaths()).toEqual([]);
    expect(fileIds()).toEqual([]);
  });

  it("FolderDataAdd replaces an existing row atomically", async () => {
    const first = await createFolder(
      "/replace-me",
      new Date("2020-01-01T00:00:00.000Z"),
    );
    const updatedDate = new Date("2021-01-01T00:00:00.000Z");
    const replacement = new Folder(accountId, "/replace-me");
    replacement.id = first.id;
    replacement.idCloud = "/cloud/replaced";
    replacement.dateSync = updatedDate;
    replacement.dateUpdated = updatedDate;
    await folderData.FolderDataAdd(span, replacement);

    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND folderpath = '/replace-me'",
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].idCloud).toBe("/cloud/replaced");
    expect(new Date(rows[0].dateUpdated).toISOString()).toBe(
      updatedDate.toISOString(),
    );
  });

  it("FolderDataAdd never destroys the existing row when the update payload is invalid", async () => {
    const existing = await createFolder("/keep-on-error");
    const broken = new Folder(accountId, "/keep-on-error");
    broken.id = existing.id;
    broken.idCloud = "/cloud/keep-on-error";
    broken.dateSync = new Date();
    // The update serializes dateUpdated: an invalid value throws before any
    // statement runs, and the existing row must survive untouched.
    broken.dateUpdated = undefined;

    await expect(folderData.FolderDataAdd(span, broken)).rejects.toBeDefined();

    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND id = ?",
      [accountId, existing.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].idCloud).toBe("/cloud/keep-on-error");
  });

  it("FolderDataAdd keeps a legacy row for the same path and returns the stored folder", async () => {
    // Legacy data (manual edits) can hold a non-md5 id for an existing path.
    // The unique index forbids a second row, so it is dropped for the seed
    // and recreated before the FolderDataAdd call under test.
    SqlDbUtilsExecSQL(
      span,
      "DROP INDEX IF EXISTS folders_accountId_folderpath_unique",
    );
    const now = new Date().toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateSync, dateUpdated, info) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "folder-legacy-id",
        "/cloud/legacy-path",
        accountId,
        "/legacy-path",
        now,
        now,
        "{}",
      ],
    );
    SqlDbUtilsExecSQL(
      span,
      "CREATE UNIQUE INDEX IF NOT EXISTS folders_accountId_folderpath_unique ON folders(accountId, folderpath)",
    );

    const incoming = new Folder(accountId, "/legacy-path");
    incoming.idCloud = "/cloud/legacy-path-v2";
    incoming.dateSync = new Date();
    incoming.dateUpdated = new Date();
    const stored = await folderData.FolderDataAdd(span, incoming);

    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT id, idCloud FROM folders WHERE accountId = ? AND folderpath = ?",
      [accountId, "/legacy-path"],
    );
    // No duplicate, no delete: the legacy id stays canonical for the path.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("folder-legacy-id");
    expect(rows[0].idCloud).toBe("/cloud/legacy-path-v2");
    expect(stored.id).toBe("folder-legacy-id");
  });

  it("FolderDataRenameSubtree re-keys folders, files, shares and grants in place", async () => {
    const root = await createFolder("/mv");
    const child = await createFolder("/mv/child");
    const deep = await createFolder("/mv/child/deep");
    const sibling = await createFolder("/mv-sibling");
    // Path-based ids end with the folderpath and can be rebased; an opaque
    // id (OneDrive item id) must stay untouched.
    SqlDbUtilsExecSQL(span, "UPDATE folders SET idCloud = ? WHERE id = ?", [
      "/cloud/mv",
      root.id,
    ]);
    SqlDbUtilsExecSQL(span, "UPDATE folders SET idCloud = ? WHERE id = ?", [
      "/cloud/mv/child",
      child.id,
    ]);
    SqlDbUtilsExecSQL(span, "UPDATE folders SET idCloud = ? WHERE id = ?", [
      "ms-graph-item-123",
      deep.id,
    ]);
    insertFileRow(root.id, "mv-root-file");
    insertFileRow(child.id, "mv-child-file");
    insertFileRow(deep.id, "mv-deep-file");
    insertFileRow(sibling.id, "mv-sibling-file");
    // Curation state that must survive the re-key.
    SqlDbUtilsExecSQL(span, "UPDATE files SET favorite = 1 WHERE id = ?", [
      "mv-child-file",
    ]);
    SqlDbUtilsExecSQL(span, "UPDATE files SET trashed = 1 WHERE id = ?", [
      "mv-deep-file",
    ]);
    const now = new Date().toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO shares (id, accountId, folderId, tokenHash, dateCreated, info) VALUES (?, ?, ?, ?, ?, ?)",
      ["share-rename", accountId, child.id, "tokenhash", now, "{}"],
    );
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO users_permissions (id, userId, info) VALUES (?, ?, ?)",
      [
        "perm-rename",
        "user-rename",
        JSON.stringify({
          isAdmin: false,
          folders: [{ folderId: child.id, scope: "ro_recursive" }],
        }),
      ],
    );

    const { folderId, fileIdMoves } = await folderData.FolderDataRenameSubtree(
      span,
      accountId,
      "/mv",
      "/renamed",
      null,
    );

    // Folder ids are md5(accountId + "/" + folderpath) — same derivation as
    // the Folder constructor, folderpath included with its leading slash.
    const expectedRootId = UtilsMd5(`${accountId}/${"/renamed"}`);
    const expectedChildId = UtilsMd5(`${accountId}/${"/renamed/child"}`);
    const expectedDeepId = UtilsMd5(`${accountId}/${"/renamed/child/deep"}`);
    expect(folderId).toBe(expectedRootId);

    const renamedRows = SqlDbUtilsQuerySQL(
      span,
      "SELECT id, folderpath, idCloud FROM folders WHERE accountId = ? AND (folderpath LIKE '/renamed%' OR folderpath = '/mv-sibling') ORDER BY folderpath",
      [accountId],
    );
    expect(renamedRows).toEqual([
      { id: sibling.id, folderpath: "/mv-sibling", idCloud: "/cloud/mv-sibling" },
      {
        id: expectedRootId,
        folderpath: "/renamed",
        idCloud: "/cloud/renamed",
      },
      {
        id: expectedChildId,
        folderpath: "/renamed/child",
        idCloud: "/cloud/renamed/child",
      },
      {
        id: expectedDeepId,
        folderpath: "/renamed/child/deep",
        idCloud: "ms-graph-item-123",
      },
    ]);
    expect(
      SqlDbUtilsQuerySQL(span, "SELECT id FROM folders WHERE id = ?", [
        root.id,
      ]),
    ).toEqual([]);

    const expectedRootFileId = UtilsMd5(
      encodeURI(`${accountId}/${expectedRootId}/mv-root-file.jpg`),
    );
    const expectedChildFileId = UtilsMd5(
      encodeURI(`${accountId}/${expectedChildId}/mv-child-file.jpg`),
    );
    const expectedDeepFileId = UtilsMd5(
      encodeURI(`${accountId}/${expectedDeepId}/mv-deep-file.jpg`),
    );
    const movedFiles = SqlDbUtilsQuerySQL(
      span,
      "SELECT id, folderId, favorite, trashed FROM files WHERE id IN (?, ?, ?)",
      [expectedRootFileId, expectedChildFileId, expectedDeepFileId],
    );
    expect(movedFiles).toHaveLength(3);
    expect(
      movedFiles.find((row: any) => row.id === expectedRootFileId).folderId,
    ).toBe(expectedRootId);
    const childFileRow = movedFiles.find(
      (row: any) => row.id === expectedChildFileId,
    );
    expect(childFileRow.folderId).toBe(expectedChildId);
    expect(childFileRow.favorite).toBe(1);
    const deepFileRow = movedFiles.find(
      (row: any) => row.id === expectedDeepFileId,
    );
    expect(deepFileRow.folderId).toBe(expectedDeepId);
    expect(deepFileRow.trashed).toBe(1);
    expect(
      SqlDbUtilsQuerySQL(span, "SELECT id FROM files WHERE id IN (?, ?, ?)", [
        "mv-root-file",
        "mv-child-file",
        "mv-deep-file",
      ]),
    ).toEqual([]);

    expect(
      SqlDbUtilsQuerySQL(span, "SELECT folderId FROM shares WHERE id = ?", [
        "share-rename",
      ])[0].folderId,
    ).toBe(expectedChildId);
    const permInfo = JSON.parse(
      SqlDbUtilsQuerySQL(
        span,
        "SELECT info FROM users_permissions WHERE id = ?",
        ["perm-rename"],
      )[0].info,
    );
    expect(permInfo.folders).toEqual([
      { folderId: expectedChildId, scope: "ro_recursive" },
    ]);

    const moveTargets = fileIdMoves.map((move) => move.to).sort();
    expect(moveTargets).toEqual(
      [expectedRootFileId, expectedChildFileId, expectedDeepFileId].sort(),
    );
    // The sibling outside the renamed subtree keeps its literal id and folder.
    expect(
      SqlDbUtilsQuerySQL(span, "SELECT id, folderId FROM files WHERE id = ?", [
        "mv-sibling-file",
      ]),
    ).toEqual([{ id: "mv-sibling-file", folderId: sibling.id }]);
  });

  it("FolderDataGetByPath and FolderDataSubtreeExists resolve paths", async () => {
    expect(
      await folderData.FolderDataGetByPath(span, accountId, "/renamed"),
    ).not.toBeNull();
    expect(
      await folderData.FolderDataGetByPath(span, accountId, "/renamed-x"),
    ).toBeNull();
    expect(
      await folderData.FolderDataSubtreeExists(span, accountId, "/renamed"),
    ).toBe(true);
    expect(
      await folderData.FolderDataSubtreeExists(span, accountId, "/renamed/deep"),
    ).toBe(false);
    expect(
      await folderData.FolderDataSubtreeExists(span, accountId, "/never-created"),
    ).toBe(false);
  });
});
