import { SqlDbUtilsExecSQL, SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
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
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

// Capture the bulk enqueue instead of letting the live queue processor pick
// the items up while the spec asserts on the DB state.
jest.mock("./SyncQueue", () => ({
  ...jest.requireActual("./SyncQueue"),
  SyncQueueQueueFileItemsBulk: jest.fn(() => 0),
}));

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
  AnalysisImagesIsModelError: jest.fn(() => false),
}));

const BASE_URL = "/api/sync";

describe("SyncEnrichmentRoutes", () => {
  let ctx: RouteSpecContext;
  let tokenAdmin: string;
  let tokenUser: string;
  let bulkQueueMock: jest.Mock;
  let enrichmentRuntime: typeof import("./EnrichmentRuntime");

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    const syncQueue = await import("./SyncQueue");
    bulkQueueMock = syncQueue.SyncQueueQueueFileItemsBulk as unknown as jest.Mock;
    enrichmentRuntime = await import("./EnrichmentRuntime");
    enrichmentRuntime.EnrichmentRuntimeInit({
      ...ctx.config,
      IMAGE_CLASSIFICATION_ENABLED: true,
    });
    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw",
      isAdmin: true,
    });
    const user = await routeSpecAddUser(ctx, {
      name: "user",
      password: "pw",
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUser = await routeSpecTokenFor(ctx, user);
  });

  beforeEach(() => {
    bulkQueueMock.mockClear();
    enrichmentRuntime.EnrichmentRuntimeReset();
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  async function setEnrichmentState(
    fileId: string,
    state: {
      enrichmentStatus?: string | null;
      lastEnrichmentError?: string | null;
      enrichmentFailCount?: number;
      syncFailCount?: number;
      trashed?: number;
    },
  ): Promise<void> {
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET enrichmentStatus = ?, lastEnrichmentError = ?, " +
        "enrichmentFailCount = ?, syncFailCount = ?, trashed = ? WHERE id = ?",
      [
        state.enrichmentStatus ?? null,
        state.lastEnrichmentError ?? null,
        state.enrichmentFailCount ?? 0,
        state.syncFailCount ?? 0,
        state.trashed ?? 0,
        fileId,
      ],
    );
  }

  async function fileState(fileId: string): Promise<any> {
    const rows = SqlDbUtilsQuerySQL(
      ctx.span,
      "SELECT enrichmentStatus, lastEnrichmentError, enrichmentFailCount, syncFailCount " +
        "FROM files WHERE id = ?",
      [fileId],
    );
    return rows[0];
  }

  it("rejects non-admin access to the health and retry routes", async () => {
    const health = await ctx.fastify.inject({
      method: "GET",
      url: `${BASE_URL}/health`,
      headers: routeSpecAuthHeaders(tokenUser),
    });
    expect(health.statusCode).toBe(403);
    const retry = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry`,
      headers: routeSpecAuthHeaders(tokenUser),
      payload: {},
    });
    expect(retry.statusCode).toBe(403);
    const anon = await ctx.fastify.inject({
      method: "GET",
      url: `${BASE_URL}/health`,
    });
    expect(anon.statusCode).toBe(403);
  });

  it("reports library health with per-account counts and model state", async () => {
    const account = await routeSpecCreateAccount(ctx, "acct-health");
    const folder = await routeSpecCreateFolder(ctx, account.id, "/health");
    const failed = await routeSpecCreateFile(ctx, account.id, folder, "a.jpg");
    const ok = await routeSpecCreateFile(ctx, account.id, folder, "b.png");
    const pending = await routeSpecCreateFile(ctx, account.id, folder, "c.jpeg");
    const capped = await routeSpecCreateFile(ctx, account.id, folder, "d.jpg");
    await setEnrichmentState(failed.id, {
      enrichmentStatus: "failed",
      lastEnrichmentError: "Unauthorized access to file",
      enrichmentFailCount: 3,
    });
    await setEnrichmentState(ok.id, { enrichmentStatus: "ok" });
    await setEnrichmentState(pending.id, { enrichmentStatus: "pending" });
    await setEnrichmentState(capped.id, {
      enrichmentStatus: "failed",
      syncFailCount: 5,
    });
    SqlDbUtilsExecSQL(ctx.span, "UPDATE files SET keywords = NULL WHERE id = ?", [
      pending.id,
    ]);
    SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET lastSyncError = 'syncThumbnail Failed: timeout' WHERE id = ?",
      [capped.id],
    );

    const res = await ctx.fastify.inject({
      method: "GET",
      url: `${BASE_URL}/health`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const accountHealth = body.accounts.find(
      (entry: any) => entry.accountId === account.id,
    );
    expect(accountHealth.name).toBe("acct-health");
    expect(accountHealth.totalImages).toBeGreaterThanOrEqual(4);
    expect(accountHealth.failed).toBe(2);
    expect(accountHealth.ok).toBe(1);
    expect(accountHealth.pending).toBe(1);
    expect(accountHealth.missingKeywords).toBeGreaterThanOrEqual(1);
    expect(accountHealth.atRetryCap).toBe(1);
    expect(body.totals.failed).toBeGreaterThanOrEqual(2);
    expect(body.enrichment.enabled).toBe(true);
    expect(body.enrichment.circuitOpen).toBe(false);
    expect(body.lastEnrichmentError.error).toContain("Unauthorized");
    expect(
      body.retryCap.some(
        (entry: any) =>
          entry.cause === "syncThumbnail Failed: timeout" && entry.count >= 1,
      ),
    ).toBe(true);
  });

  it("retries enrichment for an account without touching media sync state", async () => {
    const account = await routeSpecCreateAccount(ctx, "acct-retry");
    const folder = await routeSpecCreateFolder(ctx, account.id, "/retry");
    const failed = await routeSpecCreateFile(ctx, account.id, folder, "failed.jpg");
    const pending = await routeSpecCreateFile(ctx, account.id, folder, "pending.png");
    const ok = await routeSpecCreateFile(ctx, account.id, folder, "ok.jpeg");
    const trashed = await routeSpecCreateFile(ctx, account.id, folder, "trash.jpg");
    await setEnrichmentState(failed.id, {
      enrichmentStatus: "failed",
      lastEnrichmentError: "boom",
      enrichmentFailCount: 2,
      syncFailCount: 4,
    });
    await setEnrichmentState(pending.id, { enrichmentStatus: "pending" });
    await setEnrichmentState(ok.id, { enrichmentStatus: "ok" });
    await setEnrichmentState(trashed.id, {
      enrichmentStatus: "failed",
      trashed: 1,
    });

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { accountId: account.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ matched: 2, queued: 0 });

    expect(bulkQueueMock).toHaveBeenCalledTimes(1);
    const [functionName, items, priority] = bulkQueueMock.mock.calls[0];
    expect(functionName).toBe("syncPhotoKeyWords");
    expect(priority).toBe(SyncQueueItemPriority.BATCH);
    expect(items.map((item: any) => item.id).sort()).toEqual(
      [failed.id, pending.id].sort(),
    );

    expect((await fileState(failed.id)).enrichmentStatus).toBe("pending");
    expect((await fileState(failed.id)).lastEnrichmentError).toBeNull();
    expect((await fileState(failed.id)).enrichmentFailCount).toBe(0);
    // Media retry counter is untouched by the enrichment repair.
    expect((await fileState(failed.id)).syncFailCount).toBe(4);

    expect((await fileState(pending.id)).enrichmentStatus).toBe("pending");
    expect((await fileState(ok.id)).enrichmentStatus).toBe("ok");
    expect((await fileState(trashed.id)).enrichmentStatus).toBe("failed");
  });

  it("scopes the retry to a folder subtree", async () => {
    const account = await routeSpecCreateAccount(ctx, "acct-folder");
    const parent = await routeSpecCreateFolder(ctx, account.id, "/parent");
    const child = await routeSpecCreateFolder(ctx, account.id, "/parent/child");
    const other = await routeSpecCreateFolder(ctx, account.id, "/other");
    const parentFile = await routeSpecCreateFile(
      ctx,
      account.id,
      parent,
      "parent.jpg",
    );
    const childFile = await routeSpecCreateFile(
      ctx,
      account.id,
      child,
      "child.jpg",
    );
    const otherFile = await routeSpecCreateFile(
      ctx,
      account.id,
      other,
      "other.jpg",
    );
    for (const file of [parentFile, childFile, otherFile]) {
      await setEnrichmentState(file.id, { enrichmentStatus: "failed" });
    }

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { folderId: parent.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ matched: 2, queued: 0 });
    const items = bulkQueueMock.mock.calls[0][1] as { id: string }[];
    expect(items.map((item) => item.id).sort()).toEqual(
      [parentFile.id, childFile.id].sort(),
    );
    expect((await fileState(otherFile.id)).enrichmentStatus).toBe("failed");
  });

  it("retries a single file and validates unknown ids", async () => {
    const account = await routeSpecCreateAccount(ctx, "acct-file");
    const folder = await routeSpecCreateFolder(ctx, account.id, "/single");
    const first = await routeSpecCreateFile(ctx, account.id, folder, "one.jpg");
    const second = await routeSpecCreateFile(ctx, account.id, folder, "two.jpg");
    await setEnrichmentState(first.id, { enrichmentStatus: "failed" });
    await setEnrichmentState(second.id, { enrichmentStatus: "failed" });

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry/${first.id}`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ matched: 1, queued: 0 });
    expect((bulkQueueMock.mock.calls[0][1] as any[]).map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect((await fileState(first.id)).enrichmentStatus).toBe("pending");
    expect((await fileState(second.id)).enrichmentStatus).toBe("failed");

    const missing = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry/no-such-file`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses repair when classification is disabled", async () => {
    enrichmentRuntime.EnrichmentRuntimeInit({
      ...ctx.config,
      IMAGE_CLASSIFICATION_ENABLED: false,
    });
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/enrichment/retry`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    enrichmentRuntime.EnrichmentRuntimeInit({
      ...ctx.config,
      IMAGE_CLASSIFICATION_ENABLED: true,
    });
  });
});
