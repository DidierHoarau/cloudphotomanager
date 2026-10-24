import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFileCacheAssets,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { User } from "../model/User";
import { Folder } from "../model/Folder";
import { File } from "../model/File";
import { AccountDefinition } from "../model/AccountDefinition";
import { UserPermission } from "../model/UserPermission";
import {
  MediaSignatureFields,
  MediaSigningExp,
  MediaSigningUrl,
} from "./MediaSigning";
import { ShareDataCreate, ShareDataDelete } from "../shares/ShareData";

// The missing-asset path enqueues a cache rebuild; keep it from running
// asynchronously after the suite has torn down.
jest.mock("../sync/SyncFileCache", () => {
  const actual = jest.requireActual("../sync/SyncFileCache");
  return {
    ...actual,
    SyncFileCacheCheckAsync: jest.fn().mockResolvedValue(undefined),
  };
});


describe("MediaRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: AccountDefinition;
  let accountB: AccountDefinition;
  let folderAPhotos: Folder;
  let folderBPhotos: Folder;
  let fileA: File;
  let fileB: File;
  let restricted: User;
  let restrictedToken: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "account-a");
    accountB = await routeSpecCreateAccount(ctx, "account-b");
    // Same folder name in both accounts: permissions must never be resolved
    // by path alone.
    folderAPhotos = await routeSpecCreateFolder(ctx, accountA.id, "/photos");
    folderBPhotos = await routeSpecCreateFolder(ctx, accountB.id, "/photos");
    fileA = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderAPhotos,
      "photo.jpg",
    );
    fileB = await routeSpecCreateFile(
      ctx,
      accountB.id,
      folderBPhotos,
      "photo.jpg",
    );
    await routeSpecCreateFileCacheAssets(ctx, fileA, {
      videoPreview: "video-content",
    });
    await routeSpecCreateFileCacheAssets(ctx, fileB);

    restricted = await routeSpecAddUser(ctx, {
      name: "restricted",
      password: "pw-restricted",
      grants: [{ folderId: folderAPhotos.id, scope: "ro_recursive" }],
    });
    restrictedToken = await routeSpecTokenFor(ctx, restricted);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  function userUrl(
    file: File,
    overrides: Partial<MediaSignatureFields> = {},
  ): string {
    return MediaSigningUrl({
      kind: "user",
      accountId: file.accountId,
      fileId: file.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: restricted.id,
      subjectVersion: restricted.tokenVersion ?? 0,
      ...overrides,
    });
  }

  function get(url: string, token?: string) {
    return ctx.fastify.inject({
      method: "GET",
      url,
      headers: token ? routeSpecAuthHeaders(token) : {},
    });
  }

  it("rejects anonymous media requests", async () => {
    const res = await get(userUrl(fileA));
    expect(res.statusCode).toBe(403);
  });

  it("serves cached media for an authorized session with private cache headers", async () => {
    const res = await get(userUrl(fileA), restrictedToken);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("thumbnail-content");
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers["vary"]).toBe("Cookie, Authorization");
    expect(res.headers["accept-ranges"]).toBe("bytes");
  });

  it("serves a byte range for video previews", async () => {
    const url = userUrl(fileA, { asset: "preview.mp4" });
    const res = await ctx.fastify.inject({
      method: "GET",
      url,
      headers: { ...routeSpecAuthHeaders(restrictedToken), range: "bytes=0-4" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-4/13");
    expect(res.body).toBe("video");
  });

  it("rejects expired or tampered URLs", async () => {
    const pastExp = MediaSigningExp() - 7200;
    const past = await get(userUrl(fileA, { exp: pastExp }), restrictedToken);
    expect(past.statusCode).toBe(403);

    const offline = MediaSigningUrl({
      kind: "user",
      accountId: fileA.accountId,
      fileId: fileA.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: restricted.id,
      subjectVersion: restricted.tokenVersion ?? 0,
    });
    const tampered = offline.replace("thumbnail.webp", "preview.webp");
    const tamperedRes = await get(tampered, restrictedToken);
    expect(tamperedRes.statusCode).toBe(403);
  });

  it("stops serving as soon as the live folder grant is removed", async () => {
    const url = userUrl(fileA);
    expect((await get(url, restrictedToken)).statusCode).toBe(200);

    const permission = new UserPermission();
    permission.userId = restricted.id;
    permission.info.isAdmin = false;
    permission.info.folders = [];
    await ctx.userPermissionData.UserPermissionDataUpdateForUser(
      ctx.span,
      restricted.id,
      permission,
    );

    // Same token, same signed URL: the live permission check must deny it.
    expect((await get(url, restrictedToken)).statusCode).toBe(403);

    permission.info.folders = [
      { folderId: folderAPhotos.id, scope: "ro_recursive" },
    ];
    await ctx.userPermissionData.UserPermissionDataUpdateForUser(
      ctx.span,
      restricted.id,
      permission,
    );
  });

  it("does not resolve permissions by folder name across accounts", async () => {
    // The user is granted /photos of account A only. A URL for the equally
    // named folder of account B must be denied.
    const res = await get(userUrl(fileB), restrictedToken);
    expect(res.statusCode).toBe(403);

    // A signature for account A cannot be replayed on account B either.
    const crossAccount = userUrl(fileA).replace(
      `/api/media/${accountA.id}/`,
      `/api/media/${accountB.id}/`,
    );
    expect((await get(crossAccount, restrictedToken)).statusCode).toBe(403);
  });

  it("stops serving a signed URL once the session version is revoked", async () => {
    const user = await routeSpecAddUser(ctx, {
      name: "revoked",
      password: "pw-revoked",
      isAdmin: true,
    });
    const token = await routeSpecTokenFor(ctx, user);
    const url = MediaSigningUrl({
      kind: "user",
      accountId: fileA.accountId,
      fileId: fileA.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: user.id,
      subjectVersion: user.tokenVersion ?? 0,
    });
    expect((await get(url, token)).statusCode).toBe(200);

    await ctx.userData.UserDataBumpTokenVersion(ctx.span, user.id);
    expect((await get(url, token)).statusCode).toBe(403);
  });

  it("stops serving share media once the share is revoked", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountA.id,
      folderAPhotos.id,
    );
    const url = MediaSigningUrl({
      kind: "share",
      accountId: accountA.id,
      fileId: fileA.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: created.share.id,
      subjectVersion: 0,
    });
    expect((await get(url)).statusCode).toBe(200);

    await ShareDataDelete(ctx.span, created.share.id);
    expect((await get(url)).statusCode).toBe(404);
  });

  it("rejects a share URL whose account does not match the share", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountB.id,
      folderBPhotos.id,
    );
    const url = MediaSigningUrl({
      kind: "share",
      accountId: accountA.id,
      fileId: fileA.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: created.share.id,
      subjectVersion: 0,
    });
    expect((await get(url)).statusCode).toBe(403);
  });

  it("rejects share management through a mismatched account/folder path", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountB.id,
      folderBPhotos.id,
    );
    const admin = await routeSpecAddUser(ctx, {
      name: "share-admin",
      password: "pw-share-admin",
      isAdmin: true,
    });
    const token = await routeSpecTokenFor(ctx, admin);

    const wrongList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderBPhotos.id}/share`,
      headers: routeSpecAuthHeaders(token),
    });
    expect(wrongList.statusCode).toBe(404);

    const wrongDelete = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountA.id}/folders/${folderBPhotos.id}/share/${created.share.id}`,
      headers: routeSpecAuthHeaders(token),
    });
    expect(wrongDelete.statusCode).toBe(404);
    // The share is still active: the mismatched path did not delete it.
    const shareUrl = MediaSigningUrl({
      kind: "share",
      accountId: accountB.id,
      fileId: fileB.id,
      asset: "thumbnail.webp",
      exp: MediaSigningExp(),
      subjectId: created.share.id,
      subjectVersion: 0,
    });
    expect((await get(shareUrl)).statusCode).toBe(200);

    const rightDelete = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/accounts/${accountB.id}/folders/${folderBPhotos.id}/share/${created.share.id}`,
      headers: routeSpecAuthHeaders(token),
    });
    expect(rightDelete.statusCode).toBe(202);
  });

  it("returns 404 instead of serving a missing cache asset", async () => {
    const pending = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderAPhotos,
      "pending.jpg",
    );
    const url = userUrl(pending);
    expect((await get(url, restrictedToken)).statusCode).toBe(404);
  });
});
