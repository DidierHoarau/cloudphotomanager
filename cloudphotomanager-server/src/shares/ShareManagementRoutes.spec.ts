import * as crypto from "crypto";
import { SqlDbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
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
import { Album } from "../model/Album";
import { AlbumDataCreate, AlbumDataItemsAdd } from "../albums/AlbumData";

function tokenHashOf(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("ShareManagementRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let accountB: any;
  let folderA: any;
  let folderB: any;
  let fileA1: any;
  let fileA2: any;
  let albumA: Album;
  let admin: any;
  let adminToken: string;
  let nonAdminToken: string;

  const sharesUrl = "/api/shares";

  function get(url: string, token?: string) {
    return ctx.fastify.inject({
      method: "GET",
      url,
      headers: token ? routeSpecAuthHeaders(token) : {},
    });
  }

  function create(payload: any, token = adminToken) {
    return ctx.fastify.inject({
      method: "POST",
      url: sharesUrl,
      headers: routeSpecAuthHeaders(token),
      payload,
    });
  }

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-share-mgmt-a");
    accountB = await routeSpecCreateAccount(ctx, "acct-share-mgmt-b");
    folderA = await routeSpecCreateFolder(ctx, accountA.id, "/mgmt/a");
    folderB = await routeSpecCreateFolder(ctx, accountB.id, "/mgmt/b");
    fileA1 = await routeSpecCreateFile(ctx, accountA.id, folderA, "one.jpg");
    fileA2 = await routeSpecCreateFile(ctx, accountA.id, folderA, "two.jpg");

    admin = await routeSpecAddUser(ctx, {
      name: "admin-share-mgmt",
      password: "pw",
      isAdmin: true,
    });
    const nonAdmin = await routeSpecAddUser(ctx, {
      name: "non-admin-share-mgmt",
      password: "pw",
      grants: [{ folderId: folderA.id, scope: "ro_recursive" }],
    });
    adminToken = await routeSpecTokenFor(ctx, admin);
    nonAdminToken = await routeSpecTokenFor(ctx, nonAdmin);

    albumA = new Album(accountA.id, "Management album", admin.id);
    await AlbumDataCreate(ctx.span, albumA);
    await AlbumDataItemsAdd(ctx.span, albumA.id, [fileA1.id, fileA2.id]);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("is admin-only", async () => {
    expect((await get(sharesUrl)).statusCode).toBe(403);
    expect(
      (await get(sharesUrl, nonAdminToken)).statusCode,
    ).toBe(403);
    expect(
      (
        await create(
          { accountId: accountA.id, scope: "folder", scopeId: folderA.id },
          nonAdminToken,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.fastify.inject({
          method: "DELETE",
          url: `${sharesUrl}/some-id`,
          headers: routeSpecAuthHeaders(nonAdminToken),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("validates the requested share scope and target", async () => {
    expect((await create({})).statusCode).toBe(400);
    expect(
      (await create({ accountId: accountA.id, scope: "folder" })).statusCode,
    ).toBe(400);
    expect(
      (
        await create({
          accountId: accountA.id,
          scope: "everything",
          scopeId: folderA.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await create({
          accountId: "no-such-account",
          scope: "folder",
          scopeId: folderA.id,
        })
      ).statusCode,
    ).toBe(404);
    // A folder of another account is invisible through this account id.
    expect(
      (
        await create({
          accountId: accountA.id,
          scope: "folder",
          scopeId: folderB.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await create({
          accountId: accountA.id,
          scope: "album",
          scopeId: "no-such-album",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await create({
          accountId: accountA.id,
          scope: "folder",
          scopeId: folderA.id,
          expiresInDays: -3,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("creates folder, album and file shares and lists them with owner, expiry and share path", async () => {
    const folderShare = await create({
      accountId: accountA.id,
      scope: "folder",
      scopeId: folderA.id,
      expiresInDays: 5,
    });
    expect(folderShare.statusCode).toBe(201);
    const folderBody = folderShare.json();
    expect(folderBody.sharePath).toMatch(/^\/share\?t=/);
    expect(folderBody.dateExpires).toBeTruthy();

    const albumShare = await create({
      accountId: accountA.id,
      scope: "album",
      scopeId: albumA.id,
    });
    expect(albumShare.statusCode).toBe(201);

    const fileShare = await create({
      accountId: accountA.id,
      scope: "file",
      scopeId: fileA1.id,
    });
    expect(fileShare.statusCode).toBe(201);

    // The plain token is never part of the list, only the re-derivable path.
    const list = await get(`${sharesUrl}?accountId=${accountA.id}`, adminToken);
    expect(list.statusCode).toBe(200);
    const shares = list.json().shares;
    expect(shares.length).toBe(3);
    const byId = new Map(shares.map((share: any) => [share.id, share]));

    const folderEntry: any = byId.get(folderBody.shareId);
    expect(folderEntry).toMatchObject({
      accountId: accountA.id,
      scope: "folder",
      scopeId: folderA.id,
      targetName: "a",
      ownerUserId: admin.id,
      ownerName: admin.name,
      legacy: false,
    });
    expect(folderEntry.dateExpires).toBe(folderBody.dateExpires);
    expect(folderEntry.dateCreated).toBeTruthy();
    expect(folderEntry.lastAccessDate).toBeNull();

    const albumEntry: any = byId.get(albumShare.json().shareId);
    expect(albumEntry.scope).toBe("album");
    expect(albumEntry.targetName).toBe("Management album");
    expect(albumEntry.dateExpires).toBeNull();

    const fileEntry: any = byId.get(fileShare.json().shareId);
    expect(fileEntry.scope).toBe("file");
    expect(fileEntry.targetName).toBe("one.jpg");

    // Filters narrow by account, scope and target id.
    const albumOnly = await get(
      `${sharesUrl}?scope=album&scopeId=${albumA.id}`,
      adminToken,
    );
    expect(albumOnly.json().shares.map((share: any) => share.id)).toEqual([
      albumShare.json().shareId,
    ]);

    const accountBList = await get(
      `${sharesUrl}?accountId=${accountB.id}`,
      adminToken,
    );
    expect(accountBList.json().shares).toEqual([]);

    const invalidScope = await get(`${sharesUrl}?scope=nope`, adminToken);
    expect(invalidScope.statusCode).toBe(400);
  });

  it("records the last access date when a share is used", async () => {
    const created = await create({
      accountId: accountA.id,
      scope: "file",
      scopeId: fileA2.id,
    });
    const { shareId, sharePath } = created.json();

    const before = await get(`${sharesUrl}?scopeId=${fileA2.id}`, adminToken);
    expect(
      before.json().shares.find((share: any) => share.id === shareId)
        .lastAccessDate,
    ).toBeNull();

    const token = decodeURIComponent(sharePath.split("t=")[1]);
    const meta = await get(`/api/share/${token}/meta`);
    expect(meta.statusCode).toBe(200);

    const after = await get(`${sharesUrl}?scopeId=${fileA2.id}`, adminToken);
    const entry = after
      .json()
      .shares.find((share: any) => share.id === shareId);
    expect(entry.lastAccessDate).toBeTruthy();
    expect(new Date(entry.lastAccessDate).getTime()).toBeGreaterThan(
      Date.now() - 60 * 1000,
    );
  });

  it("revokes a share by id", async () => {
    const created = await create({
      accountId: accountA.id,
      scope: "folder",
      scopeId: folderA.id,
    });
    const { shareId, sharePath } = created.json();
    const token = decodeURIComponent(sharePath.split("t=")[1]);

    const revoked = await ctx.fastify.inject({
      method: "DELETE",
      url: `${sharesUrl}/${shareId}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(revoked.statusCode).toBe(202);
    expect((await get(`/api/share/${token}/meta`)).statusCode).toBe(404);

    const list = await get(`${sharesUrl}?accountId=${accountA.id}`, adminToken);
    expect(
      list.json().shares.some((share: any) => share.id === shareId),
    ).toBe(false);

    const again = await ctx.fastify.inject({
      method: "DELETE",
      url: `${sharesUrl}/${shareId}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(again.statusCode).toBe(404);
  });

  it("rotates a legacy random-token share into a copyable derived link", async () => {
    const legacyToken = "legacy-token-not-derivable";
    const legacyId = "legacy-share-mgmt";
    const dateExpires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await SqlDbUtilsExecSQL(
      ctx.span,
      "INSERT INTO shares (id, accountId, scope, folderId, tokenHash, tokenMode, ownerUserId, dateCreated, dateExpires, info) " +
        "VALUES (?, ?, 'folder', ?, ?, 'random', ?, ?, ?, '{}')",
      [
        legacyId,
        accountA.id,
        folderA.id,
        tokenHashOf(legacyToken),
        admin.id,
        new Date().toISOString(),
        dateExpires.toISOString(),
      ],
    );

    const list = await get(`${sharesUrl}?accountId=${accountA.id}`, adminToken);
    const legacyEntry: any = list
      .json()
      .shares.find((share: any) => share.id === legacyId);
    expect(legacyEntry.legacy).toBe(true);
    expect(legacyEntry.sharePath).toBeNull();

    const rotated = await ctx.fastify.inject({
      method: "POST",
      url: `${sharesUrl}/${legacyId}/rotate`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(rotated.statusCode).toBe(201);
    const body = rotated.json();
    expect(body.shareId).not.toBe(legacyId);
    expect(new Date(body.dateExpires).getTime()).toBe(dateExpires.getTime());

    expect((await get(`/api/share/${legacyToken}/meta`)).statusCode).toBe(404);

    const newToken = decodeURIComponent(body.sharePath.split("t=")[1]);
    const meta = await get(`/api/share/${newToken}/meta`);
    expect(meta.statusCode).toBe(200);
    expect(meta.json().folderName).toBe("a");

    const after = await get(`${sharesUrl}?accountId=${accountA.id}`, adminToken);
    const rotatedEntry: any = after
      .json()
      .shares.find((share: any) => share.id === body.shareId);
    expect(rotatedEntry.legacy).toBe(false);
    expect(rotatedEntry.sharePath).toBe(body.sharePath);
    // The legacy row is gone.
    expect(
      after.json().shares.some((share: any) => share.id === legacyId),
    ).toBe(false);
  });

  it("refuses to rotate an expired share", async () => {
    const created = await create({
      accountId: accountA.id,
      scope: "folder",
      scopeId: folderA.id,
    });
    const { shareId } = created.json();
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET dateExpires = ? WHERE id = ?",
      ["2000-01-01T00:00:00.000Z", shareId],
    );
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${sharesUrl}/${shareId}/rotate`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to rotate a share whose target belongs to another account", async () => {
    const created = await create({
      accountId: accountA.id,
      scope: "folder",
      scopeId: folderA.id,
    });
    const { shareId } = created.json();
    // Point the row at account B without moving the folder.
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET accountId = ? WHERE id = ?",
      [accountB.id, shareId],
    );
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${sharesUrl}/${shareId}/rotate`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });
});
