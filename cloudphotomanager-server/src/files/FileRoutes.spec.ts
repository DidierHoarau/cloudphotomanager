import * as fs from "fs-extra";
import * as path from "path";
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

jest.mock("../sync/SyncFileCache", () => ({
  ...jest.requireActual("../sync/SyncFileCache"),
  SyncFileCacheCheckAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../accounts/AccountFactory", () => ({
  ...jest.requireActual("../accounts/AccountFactory"),
  AccountFactoryGetAccountImplementation: jest.fn(),
}));

import { SyncFileCacheCheckAsync } from "../sync/SyncFileCache";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";

const checkAsyncMock = SyncFileCacheCheckAsync as unknown as jest.Mock;
const getAccountMock =
  AccountFactoryGetAccountImplementation as unknown as jest.Mock;

function stubAccount(accountId: string, downloadFileOriginal: boolean) {
  return {
    getAccountDefinition: () => ({ id: accountId }),
    getCapabilities: () => ({
      downloadFileOriginal,
      downloadPhotoThumbnail: false,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: false,
      downloadVideoPreview: false,
    }),
    downloadFile: jest.fn(
      async (
        _span: any,
        _file: any,
        destinationFolderpath: string,
        destinationFilename: string,
      ) => {
        await fs.writeFile(
          path.join(destinationFolderpath, destinationFilename),
          "original-bytes",
        );
      },
    ),
  };
}

describe("FileRoutes permissions", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let accountB: any;
  let folderP: any;
  let folderQ: any;
  let fileP: any;
  let fileQ: any;
  let tokenUserP: string;
  let tokenUserNon: string;
  let tokenAdmin: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-files-a");
    accountB = await routeSpecCreateAccount(ctx, "acct-files-b");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    fileP = await routeSpecCreateFile(ctx, accountA.id, folderP, "in-p.jpg");
    fileQ = await routeSpecCreateFile(ctx, accountA.id, folderQ, "in-q.jpg");

    const userP = await routeSpecAddUser(ctx, {
      name: "user-p",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non",
      password: "pw",
      grants: [],
    });
    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw",
      isAdmin: true,
    });
    tokenUserP = await routeSpecTokenFor(ctx, userP);
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    checkAsyncMock.mockClear();
  });

  it("rejects unauthenticated thumbnail and preview requests", async () => {
    const thumbnail = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/thumbnail`,
    });
    expect(thumbnail.statusCode).toBe(403);
    const preview = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/preview`,
    });
    expect(preview.statusCode).toBe(403);
    expect(checkAsyncMock).not.toHaveBeenCalled();
  });

  it("rejects files the user cannot access", async () => {
    const unpermitted = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/thumbnail`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(unpermitted.statusCode).toBe(403);

    const otherFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileQ.id}/thumbnail`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(otherFolder.statusCode).toBe(403);

    const unknown = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/no-such-file/thumbnail`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(unknown.statusCode).toBe(403);
    expect(checkAsyncMock).not.toHaveBeenCalled();
  });

  it("queues a cache rebuild when a permitted file has no cached thumbnail", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/thumbnail`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(res.statusCode).toBe(404);
    expect(checkAsyncMock).toHaveBeenCalledTimes(1);
    expect(checkAsyncMock).toHaveBeenCalledWith(accountA.id, fileP.id, 1);

    checkAsyncMock.mockClear();
    const preview = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/preview`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(preview.statusCode).toBe(404);
    expect(checkAsyncMock).toHaveBeenCalledTimes(1);
    expect(checkAsyncMock).toHaveBeenCalledWith(accountA.id, fileP.id, 1);
  });

  it("serves cached thumbnails and previews without queueing", async () => {
    const cacheDir = await ctx.fileData.FileDataGetFileCacheDir(
      ctx.span,
      accountA.id,
      fileP.id,
    );
    await fs.ensureDir(cacheDir);
    await fs.writeFile(path.join(cacheDir, "thumbnail.webp"), "thumb-bytes");
    await fs.writeFile(path.join(cacheDir, "preview.webp"), "preview-bytes");

    const thumbnail = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/thumbnail`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.rawPayload.toString()).toBe("thumb-bytes");
    expect(thumbnail.headers["content-disposition"]).toContain(fileP.id);

    const preview = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/preview`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.rawPayload.toString()).toBe("preview-bytes");
    expect(checkAsyncMock).not.toHaveBeenCalled();
  });

  it("keeps the /static/404 fallback a plain 404 for unauthenticated users", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/static/404`,
      headers: {
        "x-original-uri": `/static/${accountA.id}/${fileP.id[0]}/${fileP.id[1]}/${fileP.id}/thumbnail.webp`,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(checkAsyncMock).not.toHaveBeenCalled();
  });

  it("queues a cache rebuild from the /static/404 fallback for permitted files", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/static/404`,
      headers: {
        ...routeSpecAuthHeaders(tokenUserP),
        "x-original-uri": `/static/${accountA.id}/${fileP.id[0]}/${fileP.id[1]}/${fileP.id}/thumbnail.webp`,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(checkAsyncMock).toHaveBeenCalledTimes(1);
    expect(checkAsyncMock).toHaveBeenCalledWith(accountA.id, fileP.id, 1);
  });

  it("does not enqueue from /static/404 for unpermitted or mismatched files", async () => {
    checkAsyncMock.mockClear();
    const unpermitted = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/static/404`,
      headers: {
        ...routeSpecAuthHeaders(tokenUserNon),
        "x-original-uri": `/static/${accountA.id}/${fileP.id[0]}/${fileP.id[1]}/${fileP.id}/thumbnail.webp`,
      },
    });
    expect(unpermitted.statusCode).toBe(404);

    const accountMismatch = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/static/404`,
      headers: {
        ...routeSpecAuthHeaders(tokenAdmin),
        "x-original-uri": `/static/${accountB.id}/${fileP.id[0]}/${fileP.id[1]}/${fileP.id}/thumbnail.webp`,
      },
    });
    expect(accountMismatch.statusCode).toBe(404);

    const malformed = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/static/404`,
      headers: {
        ...routeSpecAuthHeaders(tokenAdmin),
        "x-original-uri": "not-a-static-uri",
      },
    });
    expect(malformed.statusCode).toBe(404);
    expect(checkAsyncMock).not.toHaveBeenCalled();
  });
});

describe("FileRoutes original download", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let folderQ: any;
  let fileP: any;
  let fileQ: any;
  let tokenUserP: string;
  let tokenUserNon: string;
  let tokenAdmin: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-download-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    fileP = await routeSpecCreateFile(ctx, accountA.id, folderP, "in-p.jpg");
    fileQ = await routeSpecCreateFile(ctx, accountA.id, folderQ, "in-q.jpg");

    const userP = await routeSpecAddUser(ctx, {
      name: "user-p-download",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non-download",
      password: "pw",
      grants: [],
    });
    const admin = await routeSpecAddUser(ctx, {
      name: "admin-download",
      password: "pw",
      isAdmin: true,
    });
    tokenUserP = await routeSpecTokenFor(ctx, userP);
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    getAccountMock.mockReset();
  });

  it("rejects unauthenticated download requests", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/download`,
    });
    expect(res.statusCode).toBe(403);
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("rejects downloads of unpermitted, other-folder or unknown files", async () => {
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, true));
    const unpermitted = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/download`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(unpermitted.statusCode).toBe(403);

    const otherFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileQ.id}/download`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(otherFolder.statusCode).toBe(403);

    const unknown = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/no-such-file/download`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(unknown.statusCode).toBe(403);
  });

  it("streams the original with attachment disposition by default", async () => {
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, true));
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/download`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("original-bytes");
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("in-p.jpg");
  });

  it("serves the original inline when requested", async () => {
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, true));
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/download?disposition=inline`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("inline");
  });

  it("rejects downloads when the account cannot serve originals", async () => {
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, false));
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/files/${fileP.id}/download`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(403);
  });
});
