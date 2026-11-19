import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
}));

import { AlbumService } from "../services/AlbumService";

describe("AlbumService", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.patch.mockReset();
    mocks.delete.mockReset();
  });

  it("lists albums for an account", async () => {
    const albums = [{ id: "al1", name: "Trip" }];
    mocks.get.mockResolvedValue({ data: { albums } });
    await expect(AlbumService.list("a1")).resolves.toEqual(albums);
    expect(mocks.get).toHaveBeenCalledWith("/api/accounts/a1/albums");
  });

  it("returns an empty list when the payload has none", async () => {
    mocks.get.mockResolvedValue({ data: {} });
    await expect(AlbumService.list("a1")).resolves.toEqual([]);
  });

  it("creates an album", async () => {
    const album = { id: "al1", name: "Trip", accountId: "a1" };
    mocks.post.mockResolvedValue({ data: album });
    await expect(AlbumService.create("a1", "Trip")).resolves.toBe(album);
    expect(mocks.post).toHaveBeenCalledWith("/api/accounts/a1/albums", {
      name: "Trip",
    });
  });

  it("gets a single album with encoded ids", async () => {
    mocks.get.mockResolvedValue({ data: { id: "al/1" } });
    await AlbumService.get("a 1", "al/1");
    expect(mocks.get).toHaveBeenCalledWith("/api/accounts/a%201/albums/al%2F1");
  });

  it("updates name, cover and order mode", async () => {
    mocks.patch.mockResolvedValue({ data: { id: "al1" } });
    await AlbumService.update("a1", "al1", {
      name: "New",
      coverFileId: null,
      orderMode: "manual",
    });
    expect(mocks.patch).toHaveBeenCalledWith("/api/accounts/a1/albums/al1", {
      name: "New",
      coverFileId: null,
      orderMode: "manual",
    });
  });

  it("removes an album", async () => {
    mocks.delete.mockResolvedValue({});
    await AlbumService.remove("a1", "al1");
    expect(mocks.delete).toHaveBeenCalledWith("/api/accounts/a1/albums/al1");
  });

  it("pages through album items with the documented defaults", async () => {
    const page = { files: [], page: 0, pageSize: 100, total: 0, orderMode: "capture" };
    mocks.get.mockResolvedValue({ data: page });
    await expect(AlbumService.getItems("a1", "al1")).resolves.toBe(page);
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/accounts/a1/albums/al1/items?page=0&pageSize=100&sortOrder=desc",
    );
  });

  it("requests a specific album items page", async () => {
    mocks.get.mockResolvedValue({ data: { files: [] } });
    await AlbumService.getItems("a1", "al1", {
      page: 2,
      pageSize: 60,
      sortOrder: "asc",
    });
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/accounts/a1/albums/al1/items?page=2&pageSize=60&sortOrder=asc",
    );
  });

  it("adds items and returns the added count", async () => {
    mocks.post.mockResolvedValue({ data: { added: 2 } });
    await expect(
      AlbumService.addItems("a1", "al1", ["f1", "f2"]),
    ).resolves.toBe(2);
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/accounts/a1/albums/al1/items",
      { fileIds: ["f1", "f2"] },
    );
  });

  it("removes items with a DELETE body", async () => {
    mocks.delete.mockResolvedValue({ data: { removed: 1 } });
    await expect(
      AlbumService.removeItems("a1", "al1", ["f1"]),
    ).resolves.toBe(1);
    expect(mocks.delete).toHaveBeenCalledWith(
      "/api/accounts/a1/albums/al1/items",
      { data: { fileIds: ["f1"] } },
    );
  });

  it("moves an item earlier or later", async () => {
    mocks.post.mockResolvedValue({ data: { orderMode: "manual" } });
    await AlbumService.moveItem("a1", "al1", "f/1", "earlier");
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/accounts/a1/albums/al1/items/f%2F1/move",
      { direction: "earlier" },
    );
  });
});
