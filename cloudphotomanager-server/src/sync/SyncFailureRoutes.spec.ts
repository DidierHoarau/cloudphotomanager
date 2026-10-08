import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecCreateAccount,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
// Type-only import: SyncFailures must not load before routeSpecSetup has set
// DATA_DIR (it resolves sync-failures.json at module load).
import type { SyncFailure } from "./SyncFailures";

// Capture queued items instead of writing them to the real queue table: the
// RouteSpecHarness boots a live queue processor that would otherwise pick the
// queued items up (execute them, remove the rows, record failures) while the
// spec is still asserting. requireActual keeps the real SyncQueueInit working
// for the harness.
jest.mock("./SyncQueue", () => ({
  ...jest.requireActual("./SyncQueue"),
  SyncQueueQueueItem: jest.fn(),
}));

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

const BASE_URL = "/api/sync/failures";

function conflictFailure(
  id: string,
  accountId: string,
  sourceFileId: string,
  targetFileId: string | null,
): SyncFailure {
  return {
    id,
    accountId,
    functionName: "folderMove",
    kind: "conflict",
    priority: 2,
    data: {},
    fileIds: [sourceFileId],
    dateCreated: new Date().toISOString(),
    conflict: {
      sourceFileId,
      targetFileId,
      targetFolderId: null,
      targetFolderpath: "/q",
      targetFilename: "target.jpg",
      source: {
        filename: "source.jpg",
        folderpath: "/p",
        dateMedia: null,
        size: 1,
      },
      target: {
        filename: "target.jpg",
        folderpath: "/q",
        dateMedia: null,
        size: 2,
      },
    },
  };
}

function errorFailure(id: string, accountId: string): SyncFailure {
  return {
    id,
    accountId,
    functionName: "fileDelete",
    kind: "error",
    priority: 2,
    data: { fileId: `err-file-${id}` },
    fileIds: [`err-file-${id}`],
    errorMessage: "boom",
    dateCreated: new Date().toISOString(),
  };
}

describe("SyncFailureRoutes resolve-all", () => {
  let ctx: RouteSpecContext;
  let accountId: string;
  let tokenAdmin: string;
  let tokenUser: string;
  // Resolved dynamically in beforeAll, after routeSpecSetup has set DATA_DIR.
  let queueItemMock: jest.Mock;

  const queued = (functionName: string) =>
    queueItemMock.mock.calls.filter((call) => call[3] === functionName);

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    const syncQueue = await import("./SyncQueue");
    queueItemMock = syncQueue.SyncQueueQueueItem as unknown as jest.Mock;
    const account = await routeSpecCreateAccount(ctx, "acct-failures");
    accountId = account.id;
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
    ctx.syncFailures.SyncFailuresClearAll();
    queueItemMock?.mockClear();
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("rejects resolve-all for non-admin users", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/resolve-all`,
      headers: routeSpecAuthHeaders(tokenUser),
      payload: { action: "deleteSource" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid action with 400", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/resolve-all`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { action: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("deleteSource-all deletes the source of every conflict and leaves errors untouched", async () => {
    for (const failure of [
      conflictFailure("ds-conflict-1", accountId, "ds-src-1", "ds-tgt-1"),
      conflictFailure("ds-conflict-2", accountId, "ds-src-2", null),
      errorFailure("ds-error", accountId),
    ]) {
      ctx.syncFailures.SyncFailuresAdd(failure);
    }

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/resolve-all`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { action: "deleteSource" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resolved: 2 });

    // One fileDelete per applicable conflict, on the source files only.
    const deletes = queued("fileDelete");
    expect(deletes.map((call) => call[5])).toEqual([
      ["ds-src-1"],
      ["ds-src-2"],
    ]);
    for (const call of deletes) {
      expect(call[2]).toEqual({ fileId: call[5][0] });
      expect(call[4]).toBe(SyncQueueItemPriority.INTERACTIVE);
    }
    // Conflicts are resolved by deleting the source: no move is re-queued.
    expect(queued("folderMove")).toEqual([]);
    // The plain error is not applicable and stays in the list.
    expect(
      ctx.syncFailures.SyncFailuresList().map((f: SyncFailure) => f.id),
    ).toEqual(["ds-error"]);
  });

  it("replace-all deletes the target and re-queues the move, skipping conflicts without a target", async () => {
    for (const failure of [
      conflictFailure("rp-conflict-1", accountId, "rp-src-1", "rp-tgt-1"),
      conflictFailure("rp-conflict-2", accountId, "rp-src-2", null),
      errorFailure("rp-error", accountId),
    ]) {
      ctx.syncFailures.SyncFailuresAdd(failure);
    }

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/resolve-all`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { action: "replace" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resolved: 1 });

    // Only the target of the applicable conflict is deleted, before the move.
    expect(queueItemMock.mock.calls[0][3]).toBe("fileDelete");
    expect(queueItemMock.mock.calls[0][2]).toEqual({ fileId: "rp-tgt-1" });
    // The move of the source into the target folder is re-queued.
    const moves = queued("folderMove");
    expect(moves).toHaveLength(1);
    expect(moves[0][1]).toBe(`folderMove:${accountId}:rp-src-1:/q`);
    expect(moves[0][2]).toEqual({ fileId: "rp-src-1", folderpath: "/q" });
    expect(moves[0][5]).toEqual(["rp-src-1"]);
    // The conflict without a target and the plain error remain.
    expect(
      ctx.syncFailures.SyncFailuresList().map((f: SyncFailure) => f.id).sort(),
    ).toEqual(["rp-conflict-2", "rp-error"]);
  });

  it("replace-all queues a single delete when several conflicts share the same target", async () => {
    for (const failure of [
      conflictFailure("sh-conflict-a", accountId, "sh-src-a", "sh-tgt"),
      conflictFailure("sh-conflict-b", accountId, "sh-src-b", "sh-tgt"),
    ]) {
      ctx.syncFailures.SyncFailuresAdd(failure);
    }

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/resolve-all`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { action: "replace" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resolved: 2 });

    expect(queued("fileDelete")).toHaveLength(1);
    expect(queued("folderMove")).toHaveLength(2);
    expect(ctx.syncFailures.SyncFailuresList()).toEqual([]);
  });

  it("still resolves a single failure per item through /:id/resolve", async () => {
    ctx.syncFailures.SyncFailuresAdd(
      conflictFailure("one-conflict", accountId, "one-src", "one-tgt"),
    );
    ctx.syncFailures.SyncFailuresAdd(errorFailure("one-error", accountId));

    const res = await ctx.fastify.inject({
      method: "POST",
      url: `${BASE_URL}/one-conflict/resolve`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { action: "deleteSource" },
    });
    expect(res.statusCode).toBe(200);
    expect(queued("fileDelete")).toHaveLength(1);
    expect(
      ctx.syncFailures.SyncFailuresList().map((f: SyncFailure) => f.id),
    ).toEqual(["one-error"]);
  });
});
