import * as fs from "fs-extra";
import * as path from "path";
import * as zlib from "zlib";
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

jest.mock("../accounts/AccountFactory", () => ({
  ...jest.requireActual("../accounts/AccountFactory"),
  AccountFactoryGetAccountImplementation: jest.fn(),
}));

import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";

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
        file: any,
        destinationFolderpath: string,
        destinationFilename: string,
      ) => {
        await fs.writeFile(
          path.join(destinationFolderpath, destinationFilename),
          `original-of-${file.filename}`,
        );
      },
    ),
  };
}

// Minimal zip central-directory reader: enough for specs to verify entry
// names and (inflated) contents of archives produced by archiver.
function zipEntries(zip: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) {
    throw new Error("Not a zip archive (no EOCD)");
  }
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  const centralEnd = centralOffset + centralSize;
  let pos = centralOffset;
  while (pos + 46 <= centralEnd && zip.readUInt32LE(pos) === 0x02014b50) {
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLen).toString();
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    entries.set(
      name,
      method === 0 ? data.toString() : zlib.inflateRawSync(data).toString(),
    );
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function waitForCleanup(predicate: () => boolean): Promise<void> {
  // The route cleans its temp files after the response has been flushed, so
  // the assertion must wait for that cleanup to complete.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !predicate()) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("RoutesFileOperationsDownload", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderZ: any;
  let folderSub: any;
  let folderOther: any;
  let fileOne: any;
  let fileTwo: any;
  let fileSub: any;
  let fileOther: any;
  let tokenAdmin: string;
  let tokenUserZ: string;

  const downloadUrl = (accountId: string) =>
    `/api/accounts/${accountId}/files/batch/operations/fileDownload`;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-bulk-a");
    folderZ = await routeSpecCreateFolder(ctx, accountA.id, "/z");
    folderSub = await routeSpecCreateFolder(ctx, accountA.id, "/z/sub");
    folderOther = await routeSpecCreateFolder(ctx, accountA.id, "/other");
    fileOne = await routeSpecCreateFile(ctx, accountA.id, folderZ, "one.jpg");
    fileTwo = await routeSpecCreateFile(ctx, accountA.id, folderZ, "two.jpg");
    fileSub = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderSub,
      "three.jpg",
    );
    fileOther = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderOther,
      "four.jpg",
    );

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-bulk",
      password: "pw",
      isAdmin: true,
    });
    const userZ = await routeSpecAddUser(ctx, {
      name: "user-z",
      password: "pw",
      grants: [{ folderId: folderZ.id, scope: "ro" }],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUserZ = await routeSpecTokenFor(ctx, userZ);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    getAccountMock.mockReset();
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, true));
  });

  it("rejects unauthenticated requests", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      payload: { fileIdList: [fileOne.id] },
    });
    expect(res.statusCode).toBe(403);
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty file list", async () => {
    const missing = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const empty = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [] },
    });
    expect(empty.statusCode).toBe(400);
  });

  it("rejects selections above the size cap", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {
        fileIdList: Array.from({ length: 501 }, (_, i) => `file-${i}`),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("fails closed when any selected file is unpermitted", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenUserZ),
      payload: { fileIdList: [fileOne.id, fileOther.id] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects when the account cannot serve originals", async () => {
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, false));
    const res = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("streams a zip with the selection's folder structure", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id, fileTwo.id, fileSub.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toContain(".zip");

    const zipBytes = res.rawPayload;
    expect(zipBytes.subarray(0, 2).toString()).toBe("PK");
    const entries = zipEntries(zipBytes);
    expect(Array.from(entries.keys()).sort()).toEqual([
      "z/one.jpg",
      "z/sub/three.jpg",
      "z/two.jpg",
    ]);
    expect(entries.get("z/one.jpg")).toBe("original-of-one.jpg");
    expect(entries.get("z/two.jpg")).toBe("original-of-two.jpg");
    expect(entries.get("z/sub/three.jpg")).toBe("original-of-three.jpg");
  });

  it("leaves no temp files behind", async () => {
    await ctx.fastify.inject({
      method: "POST",
      url: downloadUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id] },
    });
    await waitForCleanup(
      () => listFiles(path.join(ctx.tmpDir, "cache")).length === 0,
    );
    expect(listFiles(path.join(ctx.tmpDir, "cache"))).toEqual([]);
  });
});

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      result.push(...listFiles(path.join(dir, entry.name)));
    } else {
      result.push(path.join(dir, entry.name));
    }
  }
  return result;
}
