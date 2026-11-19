import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import {
  ShareDataCreate,
  ShareDataCreateForScope,
  ShareDataDelete,
  ShareDataDeleteForAccount,
  ShareDataGet,
  ShareDataGetById,
  ShareDataGetByToken,
  ShareDataListActive,
  ShareDataListForFolder,
  ShareDataPathFor,
  ShareDataTokenDerive,
} from "./ShareData";
import { routeSpecSetup, RouteSpecContext } from "../specTestUtils/RouteSpecHarness";

describe("ShareData", () => {
  let ctx: RouteSpecContext;
  const accountId = "acct-share-data";

  beforeAll(async () => {
    ctx = await routeSpecSetup();
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("stores only the token hash, never the token", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountId,
      "folder-1",
      undefined,
    );
    expect(created.token).toBeTruthy();
    expect(created.share.id).toBeTruthy();

    const rows = await SqlDbUtilsQuerySQL(
      ctx.span,
      "SELECT * FROM shares WHERE id = ?",
      [created.share.id],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tokenHash).not.toBe(created.token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets an expiry when expiresInDays is given", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountId,
      "folder-1",
      7,
    );
    const expectedLow = Date.now() + 6.9 * 24 * 60 * 60 * 1000;
    const expectedHigh = Date.now() + 7.1 * 24 * 60 * 60 * 1000;
    expect(created.share.dateExpires.getTime()).toBeGreaterThan(expectedLow);
    expect(created.share.dateExpires.getTime()).toBeLessThan(expectedHigh);
  });

  it("lists active shares of a folder without exposing tokens", async () => {
    await ShareDataCreate(ctx.span, "acct-share-data-2", "folder-list", 30);
    await ShareDataCreate(ctx.span, "acct-share-data-2", "folder-list");
    await ShareDataCreate(ctx.span, "acct-share-data-2", "folder-other");

    const shares = await ShareDataListForFolder(
      ctx.span,
      "acct-share-data-2",
      "folder-list",
    );
    expect(shares.length).toBe(2);
    for (const share of shares) {
      expect(share).not.toHaveProperty("token");
      expect(share).not.toHaveProperty("tokenHash");
    }
  });

  it("resolves a share by token and rejects wrong or expired tokens", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountId,
      "folder-token",
      undefined,
    );
    const resolved = await ShareDataGetByToken(ctx.span, created.token);
    expect(resolved.id).toBe(created.share.id);

    const wrong = await ShareDataGetByToken(ctx.span, "not-the-token");
    expect(wrong).toBeNull();

    // Backdate the expiry directly in the database.
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET dateExpires = ? WHERE id = ?",
      ["2000-01-01T00:00:00.000Z", created.share.id],
    );
    const expired = await ShareDataGetByToken(ctx.span, created.token);
    expect(expired).toBeNull();
  });

  it("deletes a share (revoke)", async () => {
    const created = await ShareDataCreate(
      ctx.span,
      accountId,
      "folder-revoke",
      undefined,
    );
    await ShareDataDelete(ctx.span, created.share.id);
    const resolved = await ShareDataGetByToken(ctx.span, created.token);
    expect(resolved).toBeNull();
  });

  it("derives a stable token and re-copyable path for new shares", async () => {
    const created = await ShareDataCreateForScope(ctx.span, {
      accountId,
      scope: "file",
      scopeId: "file-derive",
    });
    expect(created.share.tokenMode).toBe("derived");
    expect(created.token).toBe(ShareDataTokenDerive(created.share.id));
    expect(ShareDataPathFor(created.share)).toBe(
      `/share?t=${encodeURIComponent(created.token)}`,
    );

    // Re-derivation after a reload yields the same working link.
    const loaded = await ShareDataGetById(ctx.span, created.share.id);
    expect(ShareDataPathFor(loaded)).toBe(ShareDataPathFor(created.share));
    const token = decodeURIComponent(
      ShareDataPathFor(loaded).split("t=")[1],
    );
    expect((await ShareDataGetByToken(ctx.span, token)).id).toBe(
      created.share.id,
    );
  });

  it("has no copyable path for legacy random tokens", async () => {
    const created = await ShareDataCreateForScope(ctx.span, {
      accountId,
      scope: "folder",
      scopeId: "folder-legacy",
    });
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET tokenMode = 'random' WHERE id = ?",
      [created.share.id],
    );
    const loaded = await ShareDataGetById(ctx.span, created.share.id);
    expect(ShareDataPathFor(loaded)).toBeNull();
  });

  it("lists active shares with account, scope and target filters", async () => {
    const sf = await ShareDataCreateForScope(ctx.span, {
      accountId: "acct-list-active",
      scope: "folder",
      scopeId: "folder-a",
    });
    const sa = await ShareDataCreateForScope(ctx.span, {
      accountId: "acct-list-active",
      scope: "album",
      scopeId: "album-a",
    });
    const expired = await ShareDataCreateForScope(ctx.span, {
      accountId: "acct-list-active",
      scope: "file",
      scopeId: "file-a",
    });
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET dateExpires = ? WHERE id = ?",
      ["2000-01-01T00:00:00.000Z", expired.share.id],
    );

    const all = await ShareDataListActive(ctx.span, {
      accountId: "acct-list-active",
    });
    expect(all.map((share) => share.id).sort()).toEqual(
      [sa.share.id, sf.share.id].sort(),
    );

    const albumOnly = await ShareDataListActive(ctx.span, {
      scope: "album",
    });
    expect(albumOnly.some((share) => share.id === sa.share.id)).toBe(true);
    expect(albumOnly.some((share) => share.id === sf.share.id)).toBe(false);

    const byTarget = await ShareDataListActive(ctx.span, {
      scopeId: "folder-a",
    });
    expect(byTarget.map((share) => share.id)).toEqual([sf.share.id]);
  });

  it("resolves expired rows by id (management) but not for serving", async () => {
    const created = await ShareDataCreateForScope(ctx.span, {
      accountId,
      scope: "folder",
      scopeId: "folder-expired-id",
    });
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE shares SET dateExpires = ? WHERE id = ?",
      ["2000-01-01T00:00:00.000Z", created.share.id],
    );
    expect(await ShareDataGet(ctx.span, created.share.id)).toBeNull();
    expect((await ShareDataGetById(ctx.span, created.share.id)).id).toBe(
      created.share.id,
    );
  });

  it("scopes deletion to the account", async () => {
    const created = await ShareDataCreateForScope(ctx.span, {
      accountId: "acct-delete-owner",
      scope: "folder",
      scopeId: "folder-delete",
    });
    expect(
      await ShareDataDeleteForAccount(
        ctx.span,
        "acct-delete-other",
        created.share.id,
      ),
    ).toBe(0);
    expect(await ShareDataGetById(ctx.span, created.share.id)).toBeTruthy();
    expect(
      await ShareDataDeleteForAccount(
        ctx.span,
        "acct-delete-owner",
        created.share.id,
      ),
    ).toBe(1);
    expect(await ShareDataGetById(ctx.span, created.share.id)).toBeNull();
  });
});
