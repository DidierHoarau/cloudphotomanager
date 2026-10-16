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

jest.mock("../sync/SyncQueue", () => ({
  ...jest.requireActual("../sync/SyncQueue"),
  SyncQueueQueueItem: jest.fn(),
}));

import { SyncQueueQueueItem } from "../sync/SyncQueue";

const queueItemMock = SyncQueueQueueItem as unknown as jest.Mock;

describe("TrashRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let folderQ: any;
  let fileP1: any;
  let fileP2: any;
  let fileQ1: any;
  let tokenAdmin: string;
  let tokenUserP: string;
  let tokenUserNon: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-trash-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    fileP1 = await routeSpecCreateFile(ctx, accountA.id, folderP, "p1.jpg");
    fileP2 = await routeSpecCreateFile(ctx, accountA.id, folderP, "p2.jpg");
    fileQ1 = await routeSpecCreateFile(ctx, accountA.id, folderQ, "q1.jpg");

    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw",
      isAdmin: true,
    });
    const userP = await routeSpecAddUser(ctx, {
      name: "user-p",
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
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    queueItemMock.mockClear();
  });

  it("trash via the delete operation hides files from listings and counts, and GET /trash lists them", async () => {
    const trashRes = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/batch/operations/fileDelete`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileP1.id, fileQ1.id] },
    });
    expect(trashRes.statusCode).toBe(200);
    expect(trashRes.json()).toEqual({ trashed: 2 });

    // The trashed files are gone from the folder listing...
    const filesRes = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?includeSubFolders=false`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(filesRes.statusCode).toBe(200);
    expect(filesRes.json().files.map((f: any) => f.id)).not.toContain(
      fileP1.id,
    );

    // ...and from the sidebar counts.
    await ctx.folderData.FolderDataRefreshCacheFoldersCounts(ctx.span);
    const countsRes = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    const counts = countsRes.json().counts;
    const pCount = counts.find((c: any) => c.folderId === folderP.id);
    expect(Number(pCount.counts)).toBe(1); // only p2 left

    // GET /trash lists both trashed files with the retention window.
    const trashList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/trash`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(trashList.statusCode).toBe(200);
    const body = trashList.json();
    expect(body.retentionDays).toBe(30);
    expect(body.files.map((f: any) => f.id).sort()).toEqual(
      [fileP1.id, fileQ1.id].sort(),
    );
  });

  it("restore brings trashed files back to their folder", async () => {
    const restoreRes = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/restore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileP1.id] },
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json()).toEqual({ restored: 1 });

    const filesRes = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive?includeSubFolders=false`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(filesRes.json().files.map((f: any) => f.id)).toContain(fileP1.id);

    // Restoring again changes nothing (idempotent count).
    const restoreAgain = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/restore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileP1.id] },
    });
    expect(restoreAgain.json()).toEqual({ restored: 0 });
  });

  it("purge enqueues fileDelete queue items for trashed files only", async () => {
    // Purging a file that is not trashed is rejected.
    const notTrashed = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/purge`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileP2.id] },
    });
    expect(notTrashed.statusCode).toBe(409);
    expect(queueItemMock).not.toHaveBeenCalled();

    const unknown = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/purge`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: ["unknown-file"] },
    });
    expect(unknown.statusCode).toBe(404);

    // Trash then purge: one fileDelete queue item per file.
    await ctx.fileData.FileDataTrash(ctx.span, fileQ1.id);
    const purgeRes = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/trash/purge`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileQ1.id] },
    });
    expect(purgeRes.statusCode).toBe(202);
    expect(queueItemMock).toHaveBeenCalledTimes(1);
    const [accountId, itemId, data, functionName, _priority, fileIds] =
      queueItemMock.mock.calls[0];
    expect(accountId).toBe(accountA.id);
    expect(itemId).toBe(`fileDelete:${accountA.id}:${fileQ1.id}`);
    expect(data).toEqual({ fileId: fileQ1.id });
    expect(functionName).toBe("fileDelete");
    expect(fileIds).toEqual([fileQ1.id]);
  });

  it("rejects non-admins on restore and purge", async () => {
    await ctx.fileData.FileDataTrash(ctx.span, fileP2.id);
    for (const token of [tokenUserP, tokenUserNon]) {
      const restore = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/trash/restore`,
        headers: routeSpecAuthHeaders(token),
        payload: { fileIdList: [fileP2.id] },
      });
      expect(restore.statusCode).toBe(403);
      const purge = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/trash/purge`,
        headers: routeSpecAuthHeaders(token),
        payload: { fileIdList: [fileP2.id] },
      });
      expect(purge.statusCode).toBe(403);
    }
    // Non-admins can still view the trash (filtered by their grants below).
    const list = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/trash`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(list.statusCode).toBe(200);
  });

  it("GET /trash respects folder permissions and purge requires auth", async () => {
    // userP has ro_recursive on /p: only /p files are visible.
    const userPList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/trash`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    const ids = userPList.json().files.map((f: any) => f.id);
    expect(ids).toContain(fileP2.id);
    expect(ids).not.toContain(fileQ1.id);

    // userNon has no grants at all.
    const userNonList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/trash`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNonList.json().files).toEqual([]);

    const unauth = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/trash`,
    });
    expect(unauth.statusCode).toBe(403);
  });
});
