import * as fs from "fs-extra";
import * as path from "path";
import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFileCacheAssets,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { UtilsMd5 } from "../Utils";

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

jest.mock("../sync/SyncQueue", () => ({
  ...jest.requireActual("../sync/SyncQueue"),
  SyncQueueQueueItem: jest.fn(),
}));

import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";

const queueItemMock = SyncQueueQueueItem as unknown as jest.Mock;

describe("FolderRoutes permissions", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let accountB: any;
  let accountAws: any;
  let folderRoot: any;
  let folderP: any;
  let folderPChild: any;
  let folderQ: any;
  let folderAws: any;
  let folderDeletable: any;
  let fileP: any;
  let tokenAdmin: string;
  let tokenUserP: string;
  let tokenUserRec: string;
  let tokenUserNon: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-folders-a");
    accountB = await routeSpecCreateAccount(ctx, "acct-folders-b");
    accountAws = await routeSpecCreateAccount(ctx, "acct-folders-aws", "awsS3");
    folderRoot = await routeSpecCreateFolder(ctx, accountA.id, "/");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderPChild = await routeSpecCreateFolder(ctx, accountA.id, "/p/child");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    folderAws = await routeSpecCreateFolder(ctx, accountAws.id, "/aws-folder");
    folderDeletable = await routeSpecCreateFolder(ctx, accountA.id, "/to-delete");
    fileP = await routeSpecCreateFile(ctx, accountA.id, folderP, "in-p.jpg");
    await routeSpecCreateFile(ctx, accountA.id, folderQ, "in-q.jpg");
    await routeSpecCreateFile(ctx, accountA.id, folderDeletable, "gone.jpg");

    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw",
      isAdmin: true,
    });
    const userP = await routeSpecAddUser(ctx, {
      name: "user-p",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    const userRec = await routeSpecAddUser(ctx, {
      name: "user-rec",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro_recursive" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non",
      password: "pw",
      grants: [],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUserP = await routeSpecTokenFor(ctx, userP);
    tokenUserRec = await routeSpecTokenFor(ctx, userRec);
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);

    await ctx.folderData.FolderDataRefreshCacheFolders(ctx.span);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    queueItemMock.mockClear();
  });

  it("rejects unauthenticated folder listing", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("filters the folder list per user grants", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    const adminIds = admin
      .json()
      .folders.map((f: any) => f.id)
      .sort();
    expect(adminIds).toEqual(
      [
        folderRoot.id,
        folderP.id,
        folderPChild.id,
        folderQ.id,
        folderDeletable.id,
      ].sort(),
    );

    const userP = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.statusCode).toBe(200);
    expect(userP.json().folders.map((f: any) => f.id)).toEqual([folderP.id]);

    const userRec = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
      headers: routeSpecAuthHeaders(tokenUserRec),
    });
    expect(userRec.statusCode).toBe(200);
    expect(userRec.json().folders.map((f: any) => f.id).sort()).toEqual(
      [folderP.id, folderPChild.id].sort(),
    );

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.statusCode).toBe(200);
    expect(userNon.json().folders).toEqual([]);
  });

  it("filters folder counts per user grants", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    const adminCounts: any[] = admin.json().counts;
    expect(adminCounts.some((c) => c.folderId === folderP.id)).toBe(true);
    expect(adminCounts.some((c) => c.folderId === folderQ.id)).toBe(true);

    const userP = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/counts`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.statusCode).toBe(200);
    const userPCounts: any[] = userP.json().counts;
    expect(userPCounts.map((c) => c.folderId)).toEqual([folderP.id]);

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/counts`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.statusCode).toBe(200);
    expect(userNon.json().counts).toEqual([]);
  });

  it("enforces folder permission on the file listings", async () => {
    const denied = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(denied.statusCode).toBe(403);

    const otherFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderQ.id}/files`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(otherFolder.statusCode).toBe(403);

    const allowed = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().files.map((f: any) => f.id)).toEqual([fileP.id]);

    const recursive = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?includeSubFolders=true`,
      headers: routeSpecAuthHeaders(tokenUserRec),
    });
    expect(recursive.statusCode).toBe(200);
    expect(recursive.json().files.map((f: any) => f.id)).toContain(fileP.id);

    const recursiveDenied = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderQ.id}/files-recursive?includeSubFolders=true`,
      headers: routeSpecAuthHeaders(tokenUserRec),
    });
    expect(recursiveDenied.statusCode).toBe(403);

    // A missing folder resolves to an empty result, not an error.
    const missing = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/no-such-folder/files`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().files).toEqual([]);
  });

  it("supports favoriteOnly and hides trashed files from listings", async () => {
    const fileP2 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderP,
      "in-p-2.jpg",
    );
    await ctx.fileData.FileDataUpdateFavorite(ctx.span, fileP.id, true);

    const recursiveUrl = `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?includeSubFolders=true`;

    const all = await ctx.fastify.inject({
      method: "GET",
      url: recursiveUrl,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(all.json().files.map((f: any) => f.id).sort()).toEqual(
      [fileP.id, fileP2.id].sort(),
    );

    const favorites = await ctx.fastify.inject({
      method: "GET",
      url: `${recursiveUrl}&favoriteOnly=true`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(favorites.json().total).toBe(1);
    expect(favorites.json().files.map((f: any) => f.id)).toEqual([fileP.id]);

    await ctx.fileData.FileDataTrash(ctx.span, fileP2.id, accountA.id);

    const afterTrash = await ctx.fastify.inject({
      method: "GET",
      url: recursiveUrl,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(afterTrash.json().files.map((f: any) => f.id)).toEqual([fileP.id]);

    const singleFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(singleFolder.json().files.map((f: any) => f.id)).toEqual([fileP.id]);
  });

  it("enforces permission on folder sync requests", async () => {
    const denied = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/sync`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(denied.statusCode).toBe(403);
    expect(queueItemMock).not.toHaveBeenCalled();

    const allowed = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/sync`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(allowed.statusCode).toBe(200);
    expect(queueItemMock).toHaveBeenCalledWith(
      accountA.id,
      folderP.id,
      { folderId: folderP.id },
      "SyncInventorySyncFolder",
      expect.anything(),
    );
  });

  it("returns 404 when the folder belongs to another account", async () => {
    const res = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountB.id}/folders/${folderP.id}/sync`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
    expect(queueItemMock).not.toHaveBeenCalled();
  });

  it("queues the whole subtree on deep-sync", async () => {
    queueItemMock.mockClear();
    const res = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/deep-sync`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const syncedFolderIds = queueItemMock.mock.calls.map((call) => call[1]);
    expect(syncedFolderIds.sort()).toEqual([folderP.id, folderPChild.id].sort());
  });

  it("keeps local state untouched when the cloud folder delete fails (D3)", async () => {
    const awsAccount = await AccountFactoryGetAccountImplementation(
      accountAws.id,
    );
    const deleteSpy = jest
      .spyOn(awsAccount, "deleteFolder")
      .mockRejectedValue(new Error("S3 unavailable"));
    try {
      const res = await ctx.fastify.inject({
        method: "DELETE",
        url: `/api/accounts/${accountAws.id}/folders/${folderAws.id}/operations/delete`,
        headers: routeSpecAuthHeaders(tokenAdmin),
      });
      expect(res.statusCode).toBe(503);
      expect(
        await ctx.folderData.FolderDataGet(ctx.span, folderAws.id),
      ).toBeTruthy();
      expect(queueItemMock).not.toHaveBeenCalled();
    } finally {
      deleteSpy.mockRestore();
    }
  });

  it("rejects deleting a folder through another account id", async () => {
    queueItemMock.mockClear();
    const res = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountB.id}/folders/${folderP.id}/operations/delete`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
    expect(await ctx.folderData.FolderDataGet(ctx.span, folderP.id)).toBeTruthy();
    expect(queueItemMock).not.toHaveBeenCalled();
  });

  it("restricts folder operations to admins", async () => {
    const deleteDenied = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/operations/delete`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(deleteDenied.statusCode).toBe(403);

    const renameDenied = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/operations/rename`,
      headers: routeSpecAuthHeaders(tokenUserP),
      payload: { newName: "renamed" },
    });
    expect(renameDenied.statusCode).toBe(403);

    const renameMissingName = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/operations/rename`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    expect(renameMissingName.statusCode).toBe(400);

    const renameInvalidName = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/operations/rename`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { newName: "a/b" },
    });
    expect(renameInvalidName.statusCode).toBe(400);
  });

  it("rejects invalid pagination parameters on files-recursive with 400", async () => {
    for (const pagination of [
      "pageSize=-1",
      "pageSize=0",
      "pageSize=201",
      "pageSize=abc",
      "page=-1",
      "page=abc",
    ]) {
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?includeSubFolders=true&${pagination}`,
        headers: routeSpecAuthHeaders(tokenAdmin),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid parameter");
    }
    const ok = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?page=0&pageSize=200`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(ok.statusCode).toBe(200);
  });

  it("rename keeps curation, shares, grants and cache dirs in place (M6)", async () => {
    queueItemMock.mockClear();
    const folderRen = await routeSpecCreateFolder(ctx, accountA.id, "/ren-me");
    const folderRenChild = await routeSpecCreateFolder(
      ctx,
      accountA.id,
      "/ren-me/child",
    );
    const fileFav = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderRen,
      "fav.jpg",
    );
    const fileTrash = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderRenChild,
      "gone.jpg",
    );
    const fileShared = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderRenChild,
      "shared.jpg",
    );
    await ctx.fileData.FileDataUpdateFavorite(ctx.span, fileFav.id, true);
    await ctx.fileData.FileDataUpdateKeywords(ctx.span, {
      ...fileFav,
      keywords: "holiday",
    } as any);
    await ctx.fileData.FileDataTrash(ctx.span, fileTrash.id, accountA.id);
    const oldCacheDir = await routeSpecCreateFileCacheAssets(ctx, fileFav);

    // A share on the renamed subtree must keep serving its token.
    const shareRes = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/folders/${folderRenChild.id}/share`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { expiresInDays: 7 },
    });
    expect(shareRes.statusCode).toBe(201);
    const shareToken = decodeURIComponent(
      shareRes.json().sharePath.split("t=")[1],
    );

    // A grant on the subtree must keep granting after the rename.
    const grantUser = await routeSpecAddUser(ctx, {
      name: "user-ren",
      password: "pw",
      grants: [{ folderId: folderRen.id, scope: "ro_recursive" }],
    });
    const grantToken = await routeSpecTokenFor(ctx, grantUser);

    const res = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderRen.id}/operations/rename`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { newName: "renamed" },
    });
    expect(res.statusCode).toBe(202);

    // Folder ids are md5(accountId + "/" + folderpath) with the path's own
    // leading slash — same derivation as the Folder constructor.
    const expectedFolderId = UtilsMd5(
      encodeURI(`${accountA.id}/${"/renamed"}`),
    );
    const expectedChildId = UtilsMd5(
      encodeURI(`${accountA.id}/${"/renamed/child"}`),
    );
    const renamedFolder = await ctx.folderData.FolderDataGet(
      ctx.span,
      expectedFolderId,
    );
    expect(renamedFolder.folderpath).toBe("/renamed");
    const renamedChild = await ctx.folderData.FolderDataGet(
      ctx.span,
      expectedChildId,
    );
    expect(renamedChild.folderpath).toBe("/renamed/child");
    expect(
      await ctx.folderData.FolderDataGet(ctx.span, folderRen.id),
    ).toBeNull();

    // Files are re-keyed with curation and keywords preserved.
    const expectedFavId = UtilsMd5(
      encodeURI(`${accountA.id}/${expectedFolderId}/fav.jpg`),
    );
    const favAfter = await ctx.fileData.FileDataGet(ctx.span, expectedFavId);
    expect(favAfter.favorite).toBe(1);
    expect(favAfter.keywords).toBe("holiday");
    const expectedTrashId = UtilsMd5(
      encodeURI(`${accountA.id}/${expectedChildId}/gone.jpg`),
    );
    const trashAfter = await ctx.fileData.FileDataGet(
      ctx.span,
      expectedTrashId,
    );
    expect(trashAfter.trashed).toBe(1);
    expect(
      await ctx.fileData.FileDataGet(ctx.span, fileFav.id),
    ).toBeNull();
    expect(
      await ctx.fileData.FileDataGet(ctx.span, fileTrash.id),
    ).toBeNull();

    // The share token still resolves and lists the files at their new ids
    // (trashed files stay hidden from listings, as before the rename).
    const expectedSharedId = UtilsMd5(
      encodeURI(`${accountA.id}/${expectedChildId}/shared.jpg`),
    );
    const shareList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${shareToken}/folders/${expectedChildId}/files-recursive?includeSubFolders=false`,
    });
    expect(shareList.statusCode).toBe(200);
    expect(shareList.json().files.map((f: any) => f.id)).toEqual([
      expectedSharedId,
    ]);
    expect(
      await ctx.fileData.FileDataGet(ctx.span, fileShared.id),
    ).toBeNull();

    // The granted user still sees the renamed folder (cache refreshed: the
    // rename path refreshes it debounced).
    await ctx.folderData.FolderDataRefreshCacheFolders(ctx.span);
    const grantedList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/`,
      headers: routeSpecAuthHeaders(grantToken),
    });
    expect(
      grantedList.json().folders.map((f: any) => f.id),
    ).toEqual([expectedFolderId, expectedChildId]);

    // The media cache directory moved with the file id.
    const newCacheDir = await ctx.fileData.FileDataGetFileCacheDir(
      ctx.span,
      accountA.id,
      expectedFavId,
    );
    expect(fs.existsSync(path.join(newCacheDir, "thumbnail.webp"))).toBe(true);
    expect(fs.existsSync(path.join(oldCacheDir, "thumbnail.webp"))).toBe(false);

    // The cloud folder was renamed on disk.
    expect(fs.existsSync(path.join(ctx.rootPath, "renamed", "fav.jpg"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(ctx.rootPath, "ren-me"))).toBe(false);

    // The renamed root and its parent are queued for re-sync.
    const queuedIds = queueItemMock.mock.calls.map((call) => call[1]);
    expect(queuedIds).toContain(expectedFolderId);
    expect(queuedIds).toContain(folderRoot.id);
  });

  it("rename into an existing destination is rejected with 409 without touching the cloud", async () => {
    queueItemMock.mockClear();
    const folderSrc = await routeSpecCreateFolder(
      ctx,
      accountA.id,
      "/ren-conflict",
    );
    await routeSpecCreateFolder(ctx, accountA.id, "/ren-conflict/inner");
    const account = await AccountFactoryGetAccountImplementation(accountA.id);
    const renameSpy = jest.spyOn(account, "renameFolder");

    // /q already exists: both the direct row and the subtree checks collide.
    const res = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/folders/${folderSrc.id}/operations/rename`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { newName: "q" },
    });
    expect(res.statusCode).toBe(409);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(
      await ctx.folderData.FolderDataGet(ctx.span, folderSrc.id),
    ).toBeTruthy();
    expect(queueItemMock).not.toHaveBeenCalled();
    renameSpy.mockRestore();
  });

  it("deletes the cloud folder before reporting success", async () => {
    queueItemMock.mockClear();
    expect(fs.existsSync(folderDeletable.idCloud)).toBe(true);
    const res = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountA.id}/folders/${folderDeletable.id}/operations/delete`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(202);
    expect(fs.existsSync(folderDeletable.idCloud)).toBe(false);
    // The folder row is deleted by id, not by its path.
    expect(
      await ctx.folderData.FolderDataGet(ctx.span, folderDeletable.id),
    ).toBeNull();
    // The item is keyed by the deleted folder but re-syncs its parent
    // (SyncQueue dispatches on data.folderId).
    expect(queueItemMock).toHaveBeenCalledWith(
      accountA.id,
      folderDeletable.id,
      { folderId: folderRoot.id },
      "SyncInventorySyncFolder",
      expect.anything(),
    );
  });
});
