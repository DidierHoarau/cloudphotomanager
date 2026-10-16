import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import {
  ShareDataCreate,
  ShareDataDelete,
  ShareDataGetByToken,
  ShareDataListForFolder,
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
});
