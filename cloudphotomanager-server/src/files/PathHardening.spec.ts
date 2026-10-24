import * as fs from "fs-extra";
import * as path from "path";
import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import {
  FileNameValidate,
  FolderPathValidate,
  PathIsInsideRoot,
} from "../files/PathValidation";
import { AccountDefinition } from "../model/AccountDefinition";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { LocalAccount } from "../accounts/localDrive/LocalDriveAccount";
import { LocalAccountInventoryGetFolderByPath } from "../accounts/localDrive/LocalDriveAccountInventory";

// These specs assert request validation only: do not let the queued sync
// operations keep running after the suite has torn down.
jest.mock("../sync/SyncQueue", () => {
  const actual = jest.requireActual("../sync/SyncQueue");
  return { ...actual, SyncQueueQueueItem: jest.fn() };
});


describe("Path validation helpers", () => {
  it("accepts plain filenames and rejects path-like names", () => {
    expect(FileNameValidate("photo.jpg")).toBeNull();
    expect(FileNameValidate("my photo 01.JPG")).toBeNull();

    for (const invalid of [
      undefined,
      "",
      "   ",
      ".",
      "..",
      "../escape.jpg",
      "sub/dir.jpg",
      "sub\\dir.jpg",
      "bad\u0000name.jpg",
      "trailing.",
      "trailing ",
      "x".repeat(256),
    ]) {
      expect(FileNameValidate(invalid)).not.toBeNull();
    }
  });

  it("accepts normalized absolute folder paths only", () => {
    expect(FolderPathValidate("/")).toBeNull();
    expect(FolderPathValidate("/photos")).toBeNull();
    expect(FolderPathValidate("/photos/2024")).toBeNull();

    for (const invalid of [
      undefined,
      "",
      "photos",
      "/photos/../etc",
      "/photos/.",
      "/photos//2024",
      "/photos/",
      "/photos\\2024",
      "/photos\u0000",
      `/${"a".repeat(4096)}`,
    ]) {
      expect(FolderPathValidate(invalid)).not.toBeNull();
    }
  });

  it("keeps resolved targets inside the root", () => {
    expect(PathIsInsideRoot("/srv/cloud", "/srv/cloud")).toBe(true);
    expect(PathIsInsideRoot("/srv/cloud", "/srv/cloud/a/b.jpg")).toBe(true);
    expect(PathIsInsideRoot("/srv/cloud", "/srv/cloud2/a.jpg")).toBe(false);
    expect(PathIsInsideRoot("/srv/cloud", "/srv/cloud/../etc")).toBe(false);
    expect(PathIsInsideRoot("/srv/cloud", "/srv")).toBe(false);
  });
});

describe("Path hardening on routes and the local account", () => {
  let ctx: RouteSpecContext;
  let accountA: AccountDefinition;
  let accountB: AccountDefinition;
  let folderP: Folder;
  let folderQ: Folder;
  let fileA: File;
  let fileB: File;
  let adminToken: string;
  let localAccount: LocalAccount;
  let localRoot: string;
  let outside: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "path-account-a");
    accountB = await routeSpecCreateAccount(ctx, "path-account-b");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    await routeSpecCreateFolder(ctx, accountB.id, "/p");
    fileA = await routeSpecCreateFile(ctx, accountA.id, folderP, "a.jpg");
    fileB = await routeSpecCreateFile(ctx, accountB.id, folderP, "b.jpg");

    const admin = await routeSpecAddUser(ctx, {
      name: "path-admin",
      password: "pw-path-admin",
      isAdmin: true,
    });
    adminToken = await routeSpecTokenFor(ctx, admin);

    localRoot = path.join(ctx.baseDir, "local-root");
    outside = path.join(ctx.baseDir, "outside");
    await fs.ensureDir(localRoot);
    await fs.ensureDir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    const definition = new AccountDefinition();
    definition.name = "local";
    definition.rootpath = localRoot;
    definition.info = { type: "localDrive" };
    definition.infoPrivate = {};
    localAccount = new LocalAccount(definition);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  function rename(fileIds: any[]) {
    return ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/fileRename`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdNames: fileIds },
    });
  }

  it("rejects unsafe rename targets and cross-account files", async () => {
    for (const filename of [
      "../escape.jpg",
      "sub/dir.jpg",
      "sub\\dir.jpg",
      "..",
      "",
      "ends-with-space ",
    ]) {
      const res = await rename([{ id: fileA.id, filename }]);
      expect(res.statusCode).toBe(400);
    }

    const crossAccount = await rename([
      { id: fileB.id, filename: "renamed.jpg" },
    ]);
    expect(crossAccount.statusCode).toBe(403);

    const missing = await rename([
      { id: "no-such-file", filename: "renamed.jpg" },
    ]);
    expect(missing.statusCode).toBe(404);

    const valid = await rename([{ id: fileA.id, filename: "renamed.jpg" }]);
    expect(valid.statusCode).toBe(201);
  });

  it("rejects traversal and unknown destinations on folder move", async () => {
    for (const folderpath of ["../outside", "/p/../outside", "relative", ""]) {
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/files/batch/operations/folderMove`,
        headers: routeSpecAuthHeaders(adminToken),
        payload: { folderpath, fileIdList: [fileA.id] },
      });
      expect(res.statusCode).toBe(400);
    }

    const unknownDestination = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/folderMove`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { folderpath: "/does-not-exist", fileIdList: [fileA.id] },
    });
    expect(unknownDestination.statusCode).toBe(400);

    const crossAccount = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/folderMove`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { folderpath: folderQ.folderpath, fileIdList: [fileB.id] },
    });
    expect(crossAccount.statusCode).toBe(403);

    const valid = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/folderMove`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { folderpath: folderQ.folderpath, fileIdList: [fileA.id] },
    });
    expect(valid.statusCode).toBe(201);
  });

  it("rejects cross-account files on trash, restore, purge and favorite", async () => {
    const trash = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/fileDelete`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdList: [fileB.id] },
    });
    expect(trash.statusCode).toBe(403);

    const restore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/restore`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdList: [fileB.id] },
    });
    expect(restore.statusCode).toBe(403);

    const purge = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/purge`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdList: [fileB.id] },
    });
    expect(purge.statusCode).toBe(403);

    const favorite = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/fileFavorite`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdList: [fileB.id], favorite: true },
    });
    expect(favorite.statusCode).toBe(403);

    const missingRestore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/restore`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIdList: ["no-such-file"] },
    });
    expect(missingRestore.statusCode).toBe(404);
  });

  it("refuses filesystem operations that escape the account root", async () => {
    const outsideFile = new File("local", "folder", "secret.txt");
    outsideFile.idCloud = path.join(outside, "secret.txt");

    await expect(localAccount.deleteFile(ctx.span, outsideFile)).rejects.toThrow(
      "Path outside account root",
    );
    await expect(
      localAccount.renameFile(ctx.span, outsideFile, "renamed.txt"),
    ).rejects.toThrow("Path outside account root");
    await expect(
      localAccount.moveFile(ctx.span, outsideFile, "/p"),
    ).rejects.toThrow("Path outside account root");
    await expect(
      localAccount.downloadFile(ctx.span, outsideFile, localRoot, "copy.txt"),
    ).rejects.toThrow("Path outside account root");

    const outsideFolder = new Folder("local", "..");
    outsideFolder.idCloud = outside;
    await expect(
      localAccount.deleteFolder(ctx.span, outsideFolder),
    ).rejects.toThrow("Path outside account root");
    await expect(
      localAccount.renameFolder(ctx.span, outsideFolder, "renamed"),
    ).rejects.toThrow("Path outside account root");

    await expect(
      LocalAccountInventoryGetFolderByPath(ctx.span, localAccount, "../outside"),
    ).rejects.toThrow("Path outside account root");
  });

  it("still moves files inside the account root", async () => {
    const sourceFolder = path.join(localRoot, "src");
    const targetFolder = path.join(localRoot, "dst");
    await fs.ensureDir(sourceFolder);
    await fs.ensureDir(targetFolder);
    await fs.writeFile(path.join(sourceFolder, "inside.jpg"), "content");

    const file = new File("local", "src", "inside.jpg");
    file.idCloud = path.join(sourceFolder, "inside.jpg");
    await localAccount.moveFile(ctx.span, file, "/dst");
    expect(await fs.pathExists(path.join(targetFolder, "inside.jpg"))).toBe(
      true,
    );
  });
});
