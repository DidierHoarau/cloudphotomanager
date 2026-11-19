import { SqlDbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFolder,
  routeSpecSetFileMeta,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { ShareDataCreateForScope, ShareDataGetById } from "../shares/ShareData";

describe("AlbumRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let accountB: any;
  let folderA1: any;
  let folderA2: any;
  let folderB1: any;
  let fileA1: any;
  let fileA2: any;
  let fileTrashed: any;
  let fileB1: any;
  let adminToken: string;
  let restrictedToken: string;
  let ownerToken: string;
  let otherGrantedToken: string;
  let noGrantToken: string;

  const albumsUrl = (accountId: string) => `/api/accounts/${accountId}/albums`;

  async function createAlbum(
    token: string,
    name: string,
    accountId = accountA.id,
  ) {
    return ctx.fastify.inject({
      method: "POST",
      url: albumsUrl(accountId),
      headers: routeSpecAuthHeaders(token),
      payload: { name },
    });
  }

  async function addItems(token: string, albumId: string, fileIds: string[]) {
    return ctx.fastify.inject({
      method: "POST",
      url: `${albumsUrl(accountA.id)}/${albumId}/items`,
      headers: routeSpecAuthHeaders(token),
      payload: { fileIds },
    });
  }

  function get(url: string, token?: string) {
    return ctx.fastify.inject({
      method: "GET",
      url,
      headers: token ? routeSpecAuthHeaders(token) : {},
    });
  }

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-albums-a");
    accountB = await routeSpecCreateAccount(ctx, "acct-albums-b");
    folderA1 = await routeSpecCreateFolder(ctx, accountA.id, "/albums/one");
    folderA2 = await routeSpecCreateFolder(ctx, accountA.id, "/albums/two");
    folderB1 = await routeSpecCreateFolder(ctx, accountB.id, "/albums/one");
    fileA1 = await routeSpecCreateFile(ctx, accountA.id, folderA1, "a1.jpg");
    fileA2 = await routeSpecCreateFile(ctx, accountA.id, folderA2, "a2.jpg");
    fileTrashed = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderA1,
      "trashed.jpg",
    );
    fileB1 = await routeSpecCreateFile(ctx, accountB.id, folderB1, "b1.jpg");
    await routeSpecSetFileMeta(ctx, fileA1, {
      dateMedia: new Date("2020-01-01T00:00:00.000Z"),
    });
    await routeSpecSetFileMeta(ctx, fileA2, {
      dateMedia: new Date("2021-01-01T00:00:00.000Z"),
    });
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET trashed = 1 WHERE id = ?",
      [fileTrashed.id],
    );

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-albums",
      password: "pw",
      isAdmin: true,
    });
    const restricted = await routeSpecAddUser(ctx, {
      name: "restricted-albums",
      password: "pw",
      grants: [{ folderId: folderA1.id, scope: "ro_recursive" }],
    });
    const owner = await routeSpecAddUser(ctx, {
      name: "owner-albums",
      password: "pw",
      grants: [{ folderId: folderA1.id, scope: "ro_recursive" }],
    });
    const otherGranted = await routeSpecAddUser(ctx, {
      name: "other-granted-albums",
      password: "pw",
      grants: [{ folderId: folderA1.id, scope: "ro_recursive" }],
    });
    const noGrant = await routeSpecAddUser(ctx, {
      name: "no-grant-albums",
      password: "pw",
      grants: [],
    });
    adminToken = await routeSpecTokenFor(ctx, admin);
    restrictedToken = await routeSpecTokenFor(ctx, restricted);
    ownerToken = await routeSpecTokenFor(ctx, owner);
    otherGrantedToken = await routeSpecTokenFor(ctx, otherGranted);
    noGrantToken = await routeSpecTokenFor(ctx, noGrant);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("rejects anonymous album access", async () => {
    expect((await get(albumsUrl(accountA.id))).statusCode).toBe(403);
  });

  it("validates album creation input and account access", async () => {
    const missingName = await createAlbum(adminToken, "");
    expect(missingName.statusCode).toBe(400);
    const longName = await createAlbum(adminToken, "x".repeat(201));
    expect(longName.statusCode).toBe(400);
    const missingAccount = await createAlbum(
      adminToken,
      "Orphan",
      "no-such-account",
    );
    expect(missingAccount.statusCode).toBe(404);

    const noGrant = await createAlbum(noGrantToken, "Not allowed");
    expect(noGrant.statusCode).toBe(403);
  });

  it("creates a cross-folder album, orders it and edits cover/order", async () => {
    const created = await createAlbum(adminToken, "Trip 2026");
    expect(created.statusCode).toBe(201);
    const album = created.json();
    expect(album.name).toBe("Trip 2026");
    expect(album.itemCount).toBe(0);
    expect(album.orderMode).toBe("capture");
    expect(album.canEdit).toBe(true);

    const added = await addItems(adminToken, album.id, [fileA1.id, fileA2.id]);
    expect(added.statusCode).toBe(200);
    expect(added.json().added).toBe(2);

    // Duplicate adds are no-ops.
    const again = await addItems(adminToken, album.id, [fileA1.id]);
    expect(again.statusCode).toBe(200);
    expect(again.json().added).toBe(0);

    // Capture order: newest media first.
    const items = await get(
      `${albumsUrl(accountA.id)}/${album.id}/items?page=0&pageSize=10`,
      adminToken,
    );
    expect(items.statusCode).toBe(200);
    expect(items.json().total).toBe(2);
    expect(items.json().files.map((f: any) => f.id)).toEqual([
      fileA2.id,
      fileA1.id,
    ]);

    const cover = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${album.id}`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { coverFileId: fileA1.id },
    });
    expect(cover.statusCode).toBe(200);
    expect(cover.json().coverFileId).toBe(fileA1.id);
    expect(cover.json().cover.id).toBe(fileA1.id);

    // A cover outside the album is rejected.
    const badCover = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${album.id}`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { coverFileId: fileB1.id },
    });
    expect(badCover.statusCode).toBe(400);

    const moved = await ctx.fastify.inject({
      method: "POST",
      url: `${albumsUrl(accountA.id)}/${album.id}/items/${fileA1.id}/move`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { direction: "earlier" },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().orderMode).toBe("manual");

    const reordered = await get(
      `${albumsUrl(accountA.id)}/${album.id}/items?page=0&pageSize=10`,
      adminToken,
    );
    expect(reordered.json().orderMode).toBe("manual");
    expect(reordered.json().files.map((f: any) => f.id)).toEqual([
      fileA1.id,
      fileA2.id,
    ]);

    // Moving past the edge fails.
    const edge = await ctx.fastify.inject({
      method: "POST",
      url: `${albumsUrl(accountA.id)}/${album.id}/items/${fileA1.id}/move`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { direction: "earlier" },
    });
    expect(edge.statusCode).toBe(400);

    const badDirection = await ctx.fastify.inject({
      method: "POST",
      url: `${albumsUrl(accountA.id)}/${album.id}/items/${fileA1.id}/move`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { direction: "sideways" },
    });
    expect(badDirection.statusCode).toBe(400);

    const invalidOrderMode = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${album.id}`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { orderMode: "random" },
    });
    expect(invalidOrderMode.statusCode).toBe(400);

    // Removing the cover member clears it.
    const removed = await ctx.fastify.inject({
      method: "DELETE",
      url: `${albumsUrl(accountA.id)}/${album.id}/items`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { fileIds: [fileA1.id] },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBe(1);
    const afterRemove = await get(
      `${albumsUrl(accountA.id)}/${album.id}`,
      adminToken,
    );
    expect(afterRemove.json().itemCount).toBe(1);
    expect(afterRemove.json().coverFileId).toBeNull();
  });

  it("validates the item payload and file scope", async () => {
    const created = await createAlbum(adminToken, "Item validation");
    const albumId = created.json().id;

    for (const fileIds of [[], "nope", [""], Array(501).fill("id")]) {
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `${albumsUrl(accountA.id)}/${albumId}/items`,
        headers: routeSpecAuthHeaders(adminToken),
        payload: { fileIds },
      });
      expect(res.statusCode).toBe(400);
    }

    const otherAccount = await addItems(adminToken, albumId, [fileB1.id]);
    expect(otherAccount.statusCode).toBe(403);

    const trashed = await addItems(adminToken, albumId, [fileTrashed.id]);
    expect(trashed.statusCode).toBe(403);

    const unknown = await addItems(adminToken, albumId, ["no-such-file"]);
    expect(unknown.statusCode).toBe(403);
  });

  it("filters album contents and mutations by folder grants", async () => {
    const created = await createAlbum(adminToken, "Mixed grants");
    const albumId = created.json().id;
    await addItems(adminToken, albumId, [fileA1.id, fileA2.id]);

    // The restricted user is granted /albums/one only.
    const list = await get(albumsUrl(accountA.id), restrictedToken);
    expect(list.statusCode).toBe(200);
    const entry = list
      .json()
      .albums.find((album: any) => album.id === albumId);
    expect(entry).toBeTruthy();
    expect(entry.itemCount).toBe(1);
    expect(entry.canEdit).toBe(false);

    const items = await get(
      `${albumsUrl(accountA.id)}/${albumId}/items?page=0&pageSize=10`,
      restrictedToken,
    );
    expect(items.statusCode).toBe(200);
    expect(items.json().total).toBe(1);
    expect(items.json().files.map((f: any) => f.id)).toEqual([fileA1.id]);

    // A dismissed cover from an ungranted folder is not exposed.
    await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { coverFileId: fileA2.id },
    });
    const restrictedAlbum = await get(
      `${albumsUrl(accountA.id)}/${albumId}`,
      restrictedToken,
    );
    expect(restrictedAlbum.statusCode).toBe(200);
    expect(restrictedAlbum.json().cover).toBeNull();

    const patch = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(restrictedToken),
      payload: { name: "Hijacked" },
    });
    expect(patch.statusCode).toBe(403);

    const add = await addItems(restrictedToken, albumId, [fileA1.id]);
    expect(add.statusCode).toBe(403);

    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: `${albumsUrl(accountA.id)}/${albumId}/items`,
      headers: routeSpecAuthHeaders(restrictedToken),
      payload: { fileIds: [fileA1.id] },
    });
    expect(del.statusCode).toBe(403);

    const move = await ctx.fastify.inject({
      method: "POST",
      url: `${albumsUrl(accountA.id)}/${albumId}/items/${fileA1.id}/move`,
      headers: routeSpecAuthHeaders(restrictedToken),
      payload: { direction: "later" },
    });
    expect(move.statusCode).toBe(403);

    const removeAlbum = await ctx.fastify.inject({
      method: "DELETE",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(restrictedToken),
    });
    expect(removeAlbum.statusCode).toBe(403);
  });

  it("hides albums whose only files are outside the user's grants", async () => {
    const created = await createAlbum(adminToken, "Only ungranted");
    const albumId = created.json().id;
    await addItems(adminToken, albumId, [fileA2.id]);

    const list = await get(albumsUrl(accountA.id), restrictedToken);
    expect(
      list.json().albums.some((album: any) => album.id === albumId),
    ).toBe(false);

    const direct = await get(
      `${albumsUrl(accountA.id)}/${albumId}`,
      restrictedToken,
    );
    expect(direct.statusCode).toBe(404);

    const items = await get(
      `${albumsUrl(accountA.id)}/${albumId}/items?page=0&pageSize=10`,
      restrictedToken,
    );
    expect(items.statusCode).toBe(404);
  });

  it("lets a non-admin owner manage their own album only", async () => {
    const created = await createAlbum(ownerToken, "Owner album");
    expect(created.statusCode).toBe(201);
    const albumId = created.json().id;
    expect(created.json().ownerUserId).toBeTruthy();

    expect((await addItems(ownerToken, albumId, [fileA1.id])).statusCode).toBe(
      200,
    );

    const seenByOther = await get(
      `${albumsUrl(accountA.id)}/${albumId}`,
      otherGrantedToken,
    );
    expect(seenByOther.statusCode).toBe(200);
    expect(seenByOther.json().canEdit).toBe(false);

    const patchByOther = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(otherGrantedToken),
      payload: { name: "Taken over" },
    });
    expect(patchByOther.statusCode).toBe(403);

    const patchByOwner = await ctx.fastify.inject({
      method: "PATCH",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(ownerToken),
      payload: { name: "Renamed by owner" },
    });
    expect(patchByOwner.statusCode).toBe(200);
    expect(patchByOwner.json().name).toBe("Renamed by owner");
  });

  it("scopes album lookup to the account in the path", async () => {
    const created = await createAlbum(adminToken, "Account scoped");
    const albumId = created.json().id;
    const wrongAccount = await get(
      `${albumsUrl(accountB.id)}/${albumId}`,
      adminToken,
    );
    expect(wrongAccount.statusCode).toBe(404);
  });

  it("deletes an album with its items and album shares but keeps the files", async () => {
    const created = await createAlbum(adminToken, "Temporary");
    const albumId = created.json().id;
    await addItems(adminToken, albumId, [fileA1.id]);
    const share = await ShareDataCreateForScope(ctx.span, {
      accountId: accountA.id,
      scope: "album",
      scopeId: albumId,
    });

    const deleted = await ctx.fastify.inject({
      method: "DELETE",
      url: `${albumsUrl(accountA.id)}/${albumId}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(deleted.statusCode).toBe(202);

    expect((await get(`${albumsUrl(accountA.id)}/${albumId}`, adminToken)).statusCode).toBe(
      404,
    );
    expect(await ShareDataGetById(ctx.span, share.share.id)).toBeNull();
    // The files themselves stay in place.
    const file = await ctx.fileData.FileDataGet(ctx.span, fileA1.id);
    expect(file).toBeTruthy();
  });
});
