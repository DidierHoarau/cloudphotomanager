import * as fs from "fs-extra";
import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

jest.mock("../sync/SyncQueue", () => ({
  ...jest.requireActual("../sync/SyncQueue"),
  SyncQueueQueueItem: jest.fn(),
}));

import { SyncQueueQueueItem } from "../sync/SyncQueue";

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
    const res = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountAws.id}/folders/${folderAws.id}/operations/delete`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(503);
    expect(await ctx.folderData.FolderDataGet(ctx.span, folderAws.id)).toBeTruthy();
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
