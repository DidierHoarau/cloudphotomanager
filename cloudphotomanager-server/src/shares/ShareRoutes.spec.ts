import * as fs from "fs-extra";
import * as path from "path";
import * as zlib from "zlib";
import { SqlDbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
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

describe("ShareRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderShared: any;
  let folderChild: any;
  let folderElsewhere: any;
  let fileShared: any;
  let fileChild: any;
  let fileElsewhere: any;
  let tokenAdmin: string;
  let tokenUserNon: string;

  const shareUrl = (accountId: string, folderId: string) =>
    `/api/accounts/${accountId}/folders/${folderId}/share`;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-shares-a");
    folderShared = await routeSpecCreateFolder(ctx, accountA.id, "/shared");
    folderChild = await routeSpecCreateFolder(
      ctx,
      accountA.id,
      "/shared/child",
    );
    folderElsewhere = await routeSpecCreateFolder(
      ctx,
      accountA.id,
      "/elsewhere",
    );
    fileShared = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderShared,
      "in-shared.jpg",
    );
    fileChild = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderChild,
      "in-child.jpg",
    );
    fileElsewhere = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderElsewhere,
      "in-elsewhere.jpg",
    );

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-shares",
      password: "pw",
      isAdmin: true,
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non-shares",
      password: "pw",
      grants: [],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  beforeEach(() => {
    getAccountMock.mockReset();
    getAccountMock.mockResolvedValue(stubAccount(accountA.id, true));
  });

  it("rejects share management for non-admins and anonymous callers", async () => {
    const nonAdmin = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenUserNon),
      payload: {},
    });
    expect(nonAdmin.statusCode).toBe(403);

    const anonymous = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      payload: {},
    });
    expect(anonymous.statusCode).toBe(403);

    const listNonAdmin = await ctx.fastify.inject({
      method: "GET",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(listNonAdmin.statusCode).toBe(403);
  });

  it("rejects invalid expiry values", async () => {
    for (const expiresInDays of [0, -5, "abc"]) {
      const res = await ctx.fastify.inject({
        method: "POST",
        url: shareUrl(accountA.id, folderShared.id),
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: { expiresInDays },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("creates, lists and serves a share end to end", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { expiresInDays: 7 },
    });
    expect(created.statusCode).toBe(201);
    const { shareId, sharePath, dateExpires } = created.json();
    expect(shareId).toBeTruthy();
    expect(sharePath).toMatch(/^\/share\?t=/);
    expect(new Date(dateExpires).getTime()).toBeGreaterThan(Date.now());
    const token = decodeURIComponent(sharePath.split("t=")[1]);
    expect(token).not.toContain("/");

    const list = await ctx.fastify.inject({
      method: "GET",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(list.statusCode).toBe(200);
    const shares = list.json().shares;
    expect(shares.length).toBe(1);
    expect(shares[0].id).toBe(shareId);
    expect(shares[0].dateExpires).toBe(dateExpires);
    expect(JSON.stringify(shares)).not.toContain(token);

    // Public meta: folder name only, no ancestor path.
    const meta = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/meta`,
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().folderName).toBe("shared");
    expect(meta.json().dateExpires).toBe(dateExpires);

    // Public folder listing covers the subtree only.
    const folders = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders`,
    });
    expect(folders.statusCode).toBe(200);
    const folderpaths = folders.json().folders.map((f: any) => f.folderpath);
    expect(folderpaths).toContain("/shared");
    expect(folderpaths).toContain("/shared/child");
    expect(folderpaths).not.toContain("/elsewhere");

    // Public file listing (single folder and recursive).
    const files = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders/${folderShared.id}/files-recursive?page=0&pageSize=10&sortOrder=desc`,
    });
    expect(files.statusCode).toBe(200);
    expect(files.json().files.map((f: any) => f.id)).toEqual([fileShared.id]);
    expect(files.json().total).toBe(1);

    const recursive = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders/${folderShared.id}/files-recursive?includeSubFolders=true&page=0&pageSize=10`,
    });
    expect(recursive.statusCode).toBe(200);
    expect(recursive.json().total).toBe(2);

    // Public download inside the subtree works.
    const download = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/files/${fileChild.id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.payload).toBe(`original-of-${fileChild.filename}`);
    expect(download.headers["content-disposition"]).toContain(
      fileChild.filename,
    );

    const inline = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/files/${fileShared.id}/download?disposition=inline`,
    });
    expect(inline.statusCode).toBe(200);
    expect(inline.headers["content-disposition"]).toContain("inline");
  });

  it("rejects invalid pagination parameters on the public listing with 400", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderChild.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { expiresInDays: 7 },
    });
    expect(created.statusCode).toBe(201);
    const token = decodeURIComponent(
      created.json().sharePath.split("t=")[1],
    );

    for (const query of [
      "pageSize=-1",
      "pageSize=0",
      "pageSize=201",
      "pageSize=abc",
      "page=-1",
      "page=abc",
    ]) {
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${token}/folders/${folderChild.id}/files-recursive?${query}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid parameter");
    }

    const ok = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders/${folderChild.id}/files-recursive?page=0&pageSize=200`,
    });
    expect(ok.statusCode).toBe(200);
  });

  it("returns 404 for unknown tokens on every public endpoint", async () => {
    const meta = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/not-a-real-token/meta`,
    });
    expect(meta.statusCode).toBe(404);

    const folders = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/not-a-real-token/folders`,
    });
    expect(folders.statusCode).toBe(404);

    const files = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/not-a-real-token/folders/some-folder/files-recursive`,
    });
    expect(files.statusCode).toBe(404);

    const download = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/not-a-real-token/files/some-file/download`,
    });
    expect(download.statusCode).toBe(404);
  });

  it("returns 403 for folders and files outside the subtree", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    const token = decodeURIComponent(created.json().sharePath.split("t=")[1]);

    const outsideFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders/${folderElsewhere.id}/files-recursive`,
    });
    expect(outsideFolder.statusCode).toBe(403);

    const unknownFolder = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/folders/no-such-folder/files-recursive`,
    });
    expect(unknownFolder.statusCode).toBe(403);

    const outsideFile = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/files/${fileElsewhere.id}/download`,
    });
    expect(outsideFile.statusCode).toBe(403);

    const unknownFile = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/files/no-such-file/download`,
    });
    expect(unknownFile.statusCode).toBe(403);
  });

  it("stops serving expired shares", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    const { shareId, sharePath } = created.json();
    const token = decodeURIComponent(sharePath.split("t=")[1]);
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET dateExpires = ? WHERE id = ?",
      ["2000-01-01T00:00:00.000Z", shareId],
    );
    const meta = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/meta`,
    });
    expect(meta.statusCode).toBe(404);
  });

  it("stops serving revoked shares", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: shareUrl(accountA.id, folderShared.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    const { shareId, sharePath } = created.json();
    const token = decodeURIComponent(sharePath.split("t=")[1]);

    const revoked = await ctx.fastify.inject({
      method: "DELETE",
      url: `${shareUrl(accountA.id, folderShared.id)}/${shareId}`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(revoked.statusCode).toBe(202);

    const meta = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/meta`,
    });
    expect(meta.statusCode).toBe(404);

    const download = await ctx.fastify.inject({
      method: "GET",
      url: `/api/share/${token}/files/${fileShared.id}/download`,
    });
    expect(download.statusCode).toBe(404);
  });

  describe("album and single-file shares", () => {
    let albumId: string;
    let albumToken: string;
    let albumShareId: string;
    let duplicateFile: any;

    beforeAll(async () => {
      duplicateFile = await routeSpecCreateFile(
        ctx,
        accountA.id,
        folderChild,
        "in-shared.jpg",
      );
      const created = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/albums`,
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: { name: "Share album" },
      });
      expect(created.statusCode).toBe(201);
      albumId = created.json().id;
      const added = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/albums/${albumId}/items`,
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: {
          fileIds: [fileShared.id, fileElsewhere.id, duplicateFile.id],
        },
      });
      expect(added.statusCode).toBe(200);

      const shared = await ctx.fastify.inject({
        method: "POST",
        url: "/api/shares",
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: {
          accountId: accountA.id,
          scope: "album",
          scopeId: albumId,
          expiresInDays: 2,
        },
      });
      expect(shared.statusCode).toBe(201);
      albumShareId = shared.json().shareId;
      albumToken = decodeURIComponent(shared.json().sharePath.split("t=")[1]);
    });

    it("serves an album share across folders", async () => {
      const meta = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/meta`,
      });
      expect(meta.statusCode).toBe(200);
      expect(meta.json().scope).toBe("album");
      expect(meta.json().albumName).toBe("Share album");
      expect(meta.json().photoCount).toBe(3);
      expect(meta.json().dateExpires).toBeTruthy();

      // Album shares have no folder navigation.
      const folders = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/folders`,
      });
      expect(folders.statusCode).toBe(404);

      const items = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/items?page=0&pageSize=10`,
      });
      expect(items.statusCode).toBe(200);
      expect(items.json().total).toBe(3);
      expect(items.json().files.map((f: any) => f.id).sort()).toEqual(
        [fileShared.id, fileElsewhere.id, duplicateFile.id].sort(),
      );

      // Every member is individually downloadable, non-members are not.
      for (const file of [fileShared, fileElsewhere, duplicateFile]) {
        const download = await ctx.fastify.inject({
          method: "GET",
          url: `/api/share/${albumToken}/files/${file.id}/download`,
        });
        expect(download.statusCode).toBe(200);
        expect(download.payload).toBe(`original-of-${file.filename}`);
      }
      const nonMember = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/files/${fileChild.id}/download`,
      });
      expect(nonMember.statusCode).toBe(403);
    });

    it("zips the whole album or a validated selection with basename entries", async () => {
      const all = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
      });
      expect(all.statusCode).toBe(200);
      expect(all.headers["content-type"]).toBe("application/zip");
      const allEntries = zipEntries(all.rawPayload);
      expect(Array.from(allEntries.keys()).sort()).toEqual(
        [
          "child/in-shared.jpg",
          "elsewhere/in-elsewhere.jpg",
          "shared/in-shared.jpg",
        ].sort(),
      );
      expect(allEntries.get("elsewhere/in-elsewhere.jpg")).toBe(
        "original-of-in-elsewhere.jpg",
      );

      const selected = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
        payload: { fileIdList: [fileElsewhere.id] },
      });
      expect(selected.statusCode).toBe(200);
      const selectedEntries = zipEntries(selected.rawPayload);
      expect(Array.from(selectedEntries.keys())).toEqual([
        "elsewhere/in-elsewhere.jpg",
      ]);

      // A selection can never escape the album.
      const outside = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
        payload: { fileIdList: [fileChild.id] },
      });
      expect(outside.statusCode).toBe(403);

      const invalid = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
        payload: { fileIdList: [] },
      });
      expect(invalid.statusCode).toBe(400);

      const tooMany = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
        payload: {
          fileIdList: Array.from({ length: 501 }, (_, i) => `file-${i}`),
        },
      });
      expect(tooMany.statusCode).toBe(400);
    });

    it("stops serving an album share when the item is removed", async () => {
      const removed = await ctx.fastify.inject({
        method: "DELETE",
        url: `/api/accounts/${accountA.id}/albums/${albumId}/items`,
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: { fileIds: [duplicateFile.id] },
      });
      expect(removed.statusCode).toBe(200);

      const download = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/files/${duplicateFile.id}/download`,
      });
      expect(download.statusCode).toBe(403);

      const items = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${albumToken}/items?page=0&pageSize=10`,
      });
      expect(items.json().total).toBe(2);

      const zip = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${albumToken}/download`,
      });
      expect(zip.statusCode).toBe(200);
      expect(Array.from(zipEntries(zip.rawPayload).keys()).sort()).toEqual(
        ["elsewhere/in-elsewhere.jpg", "shared/in-shared.jpg"].sort(),
      );
    });

    it("serves a single-file share with only that file", async () => {
      const created = await ctx.fastify.inject({
        method: "POST",
        url: "/api/shares",
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: {
          accountId: accountA.id,
          scope: "file",
          scopeId: fileShared.id,
        },
      });
      expect(created.statusCode).toBe(201);
      const token = decodeURIComponent(created.json().sharePath.split("t=")[1]);

      const meta = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${token}/meta`,
      });
      expect(meta.statusCode).toBe(200);
      expect(meta.json()).toMatchObject({
        scope: "file",
        fileName: fileShared.filename,
        photoCount: 1,
      });

      const folders = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${token}/folders`,
      });
      expect(folders.statusCode).toBe(404);

      const items = await ctx.fastify.inject({
        method: "GET",
        url: `/api/share/${token}/items`,
      });
      expect(items.statusCode).toBe(200);
      expect(items.json().total).toBe(1);
      expect(items.json().files.map((f: any) => f.id)).toEqual([fileShared.id]);

      expect(
        (
          await ctx.fastify.inject({
            method: "GET",
            url: `/api/share/${token}/files/${fileShared.id}/download`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await ctx.fastify.inject({
            method: "GET",
            url: `/api/share/${token}/files/${fileChild.id}/download`,
          })
        ).statusCode,
      ).toBe(403);

      const zip = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${token}/download`,
        payload: { fileIdList: [fileShared.id] },
      });
      expect(zip.statusCode).toBe(200);
      expect(Array.from(zipEntries(zip.rawPayload).keys())).toEqual([
        "shared/in-shared.jpg",
      ]);

      const wrongSelection = await ctx.fastify.inject({
        method: "POST",
        url: `/api/share/${token}/download`,
        payload: { fileIdList: [fileElsewhere.id] },
      });
      expect(wrongSelection.statusCode).toBe(403);
    });

    it("stops serving expired album and file shares", async () => {
      const fileShare = await ctx.fastify.inject({
        method: "POST",
        url: "/api/shares",
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload: {
          accountId: accountA.id,
          scope: "file",
          scopeId: fileElsewhere.id,
        },
      });
      const fileToken = decodeURIComponent(
        fileShare.json().sharePath.split("t=")[1],
      );

      for (const shareId of [albumShareId, fileShare.json().shareId]) {
        await SqlDbUtilsExecSQL(
          ctx.span,
          "UPDATE shares SET dateExpires = ? WHERE id = ?",
          ["2000-01-01T00:00:00.000Z", shareId],
        );
      }

      for (const [token, fileId] of [
        [albumToken, fileShared.id],
        [fileToken, fileElsewhere.id],
      ] as const) {
        expect(
          (
            await ctx.fastify.inject({
              method: "GET",
              url: `/api/share/${token}/meta`,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await ctx.fastify.inject({
              method: "GET",
              url: `/api/share/${token}/items`,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await ctx.fastify.inject({
              method: "POST",
              url: `/api/share/${token}/download`,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await ctx.fastify.inject({
              method: "GET",
              url: `/api/share/${token}/files/${fileId}/download`,
            })
          ).statusCode,
        ).toBe(404);
      }
    });
  });
});
