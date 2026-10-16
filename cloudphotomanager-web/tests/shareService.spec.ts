import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.delete },
}));

import { ShareService } from "../services/ShareService";

describe("ShareService", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.delete.mockReset();
  });

  it("builds a share URL from the current origin with an encoded token", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://photos.example.com" },
    });
    try {
      expect(ShareService.buildShareUrl("abc/def+1")).toBe(
        "https://photos.example.com/share?t=abc%2Fdef%2B1",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("create posts to the folder share endpoint and returns the payload", async () => {
    const payload = {
      shareId: "s1",
      sharePath: "/share?t=tok",
      dateExpires: "2026-10-23T00:00:00.000Z",
    };
    mocks.post.mockResolvedValue({ data: payload });
    await expect(ShareService.create("a1", "f1", 7)).resolves.toBe(payload);
    expect(mocks.post).toHaveBeenCalledWith("/api/accounts/a1/folders/f1/share", {
      expiresInDays: 7,
    });
  });

  it("create without expiry sends an empty body", async () => {
    mocks.post.mockResolvedValue({ data: { shareId: "s1", sharePath: "/share?t=tok" } });
    await ShareService.create("a1", "f1");
    expect(mocks.post).toHaveBeenCalledWith("/api/accounts/a1/folders/f1/share", {});
  });

  it("list returns the shares array", async () => {
    const shares = [{ id: "s1", dateCreated: "c", dateExpires: null }];
    mocks.get.mockResolvedValue({ data: { shares } });
    await expect(ShareService.list("a1", "f1")).resolves.toEqual(shares);
    expect(mocks.get).toHaveBeenCalledWith("/api/accounts/a1/folders/f1/share");
  });

  it("revoke deletes the share resource", async () => {
    mocks.delete.mockResolvedValue({});
    await ShareService.revoke("a1", "f1", "s1");
    expect(mocks.delete).toHaveBeenCalledWith(
      "/api/accounts/a1/folders/f1/share/s1",
    );
  });

  it("public reads hit the token-scoped endpoints and encode the token", async () => {
    mocks.get
      .mockResolvedValueOnce({ data: { folderName: "trip", dateExpires: null } })
      .mockResolvedValueOnce({ data: { folders: [{ id: "f1", folderpath: "/trip" }] } })
      .mockResolvedValueOnce({
        data: { files: [], page: 1, pageSize: 60, total: 0 },
      });

    await expect(ShareService.getMeta("t0k/en")).resolves.toEqual({
      folderName: "trip",
      dateExpires: null,
    });
    await expect(ShareService.getFolders("t0k/en")).resolves.toEqual([
      { id: "f1", folderpath: "/trip" },
    ]);
    await expect(
      ShareService.getFiles("t0k/en", "f1", { page: 1, includeSubFolders: true }),
    ).resolves.toEqual({ files: [], page: 1, pageSize: 60, total: 0 });

    expect(mocks.get).toHaveBeenNthCalledWith(1, "/api/share/t0k%2Fen/meta");
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/api/share/t0k%2Fen/folders");
    expect(mocks.get).toHaveBeenNthCalledWith(
      3,
      "/api/share/t0k%2Fen/folders/f1/files-recursive?page=1&pageSize=60&sortOrder=desc&includeSubFolders=true",
    );
  });

  it("getFiles applies the documented defaults", async () => {
    mocks.get.mockResolvedValue({ data: { files: [], total: 0 } });
    await ShareService.getFiles("tok", "f1");
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/share/tok/folders/f1/files-recursive?page=0&pageSize=60&sortOrder=desc&includeSubFolders=false",
    );
  });

  it("downloadFile fetches a blob and triggers a browser download", async () => {
    const blob = new Blob(["original"]);
    mocks.get.mockResolvedValue({ data: blob });

    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const anchors: any[] = [];
    const FakeURL: any = {
      createObjectURL: vi.fn(() => {
        const url = `blob:fake-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((u: string) => revokedUrls.push(u)),
    };
    vi.stubGlobal("URL", FakeURL);
    const click = vi.fn();
    const appendChild = vi.fn((el: any) => {
      anchors.push(el);
      Object.defineProperty(el, "click", { value: click });
    });
    const removeChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ href: "", download: "", click })),
      body: { appendChild, removeChild },
    });
    try {
      await ShareService.downloadFile("tok", "file1", "photo.jpg");
      expect(mocks.get).toHaveBeenCalledWith(
        "/api/share/tok/files/file1/download",
        { responseType: "blob" },
      );
      expect(createdUrls).toEqual(["blob:fake-1"]);
      expect(anchors[0].href).toBe("blob:fake-1");
      expect(anchors[0].download).toBe("photo.jpg");
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokedUrls).toEqual(["blob:fake-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
