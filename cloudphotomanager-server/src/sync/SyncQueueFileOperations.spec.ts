import * as fs from "fs-extra";
import * as path from "path";
import {
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFileCacheAssets,
  routeSpecCreateFolder,
  routeSpecSetup,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { UtilsMd5 } from "../Utils";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";

// Folder re-syncs dispatched by the queue processor must not actually run
// (and must not complete), so the queue rows stay observable in assertions;
// released in afterAll so no timer/handle survives the run. Direct
// SyncInventorySyncFolder calls (the move-conflict pre-check) resolve
// immediately so the operation under test is not deadlocked.
const mockPendingFolderSyncs: (() => void)[] = [];
function mockHoldPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    mockPendingFolderSyncs.push(resolve);
  });
}

jest.mock("./SyncInventory", () => ({
  SyncInventorySyncFolder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

describe("SyncQueue file operations re-key (M6)", () => {
  let ctx: RouteSpecContext;
  let accountId: string;
  let ops: typeof import("./SyncQueue");

  function queuedFolderSyncRows(): any[] {
    return SqlDbUtilsQuerySQL(
      ctx.span,
      "SELECT * FROM sync_queue WHERE functionName = 'SyncInventorySyncFolder' ORDER BY dateCreated",
    );
  }

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    ops = await import("./SyncQueue");
    // Hold the folder re-syncs dispatched by the live queue processor.
    ops.SyncQueueRegisterFunction("SyncInventorySyncFolder", mockHoldPromise);
    const account = await routeSpecCreateAccount(ctx, "acct-fileops");
    accountId = account.id;
  });

  afterAll(async () => {
    // Release the held folder syncs so the queue processor can finish.
    for (const release of mockPendingFolderSyncs.splice(0)) {
      release();
    }
    await ctx.fastify.close();
  });

  it("fileRenameOperation re-keys the row, keeps curation and moves the cache dir", async () => {
    const folder = await routeSpecCreateFolder(ctx, accountId, "/ops-rename");
    const file = await routeSpecCreateFile(
      ctx,
      accountId,
      folder,
      "original.jpg",
    );
    const oldCacheDir = await routeSpecCreateFileCacheAssets(ctx, file);
    await ctx.fileData.FileDataUpdateFavorite(ctx.span, file.id, true);

    const account = await AccountFactoryGetAccountImplementation(accountId);
    await ops.fileRenameOperation(account, {
      fileId: file.id,
      filename: "renamed.jpg",
    });

    const expectedId = UtilsMd5(
      encodeURI(`${accountId}/${folder.id}/renamed.jpg`),
    );
    const stored = await ctx.fileData.FileDataGet(ctx.span, expectedId);
    expect(stored).not.toBeNull();
    expect(stored.filename).toBe("renamed.jpg");
    expect(stored.folderId).toBe(folder.id);
    expect(stored.favorite).toBe(1);
    expect(await ctx.fileData.FileDataGet(ctx.span, file.id)).toBeNull();

    // The cloud file exists at the new name.
    expect(
      fs.existsSync(path.join(ctx.rootPath, "ops-rename", "renamed.jpg")),
    ).toBe(true);

    // The media cache directory moved with the id.
    const newCacheDir = await ctx.fileData.FileDataGetFileCacheDir(
      ctx.span,
      accountId,
      expectedId,
    );
    expect(fs.existsSync(path.join(newCacheDir, "thumbnail.webp"))).toBe(true);
    expect(fs.existsSync(path.join(oldCacheDir, "thumbnail.webp"))).toBe(false);

    // The folder is queued for re-sync so idCloud and hash refresh.
    const rows = queuedFolderSyncRows().filter(
      (row) => JSON.parse(row.data).folderId === folder.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe(accountId);
    expect(rows[0].priority).toBe(SyncQueueItemPriority.INTERACTIVE);
  });

  it("folderMoveOperation re-keys the file into the target folder", async () => {
    const source = await routeSpecCreateFolder(
      ctx,
      accountId,
      "/ops-move-src",
    );
    const target = await routeSpecCreateFolder(ctx, accountId, "/ops-move-dst");
    const file = await routeSpecCreateFile(ctx, accountId, source, "moveme.jpg");
    const oldCacheDir = await routeSpecCreateFileCacheAssets(ctx, file);
    await ctx.fileData.FileDataUpdateKeywords(ctx.span, {
      ...file,
      keywords: "trip",
    } as any);

    const account = await AccountFactoryGetAccountImplementation(accountId);
    await ops.folderMoveOperation(account, {
      fileId: file.id,
      folderpath: "/ops-move-dst",
    });

    const expectedId = UtilsMd5(
      encodeURI(`${accountId}/${target.id}/moveme.jpg`),
    );
    const stored = await ctx.fileData.FileDataGet(ctx.span, expectedId);
    expect(stored).not.toBeNull();
    expect(stored.folderId).toBe(target.id);
    expect(stored.keywords).toBe("trip");
    expect(await ctx.fileData.FileDataGet(ctx.span, file.id)).toBeNull();

    // The cloud file moved on disk.
    expect(
      fs.existsSync(path.join(ctx.rootPath, "ops-move-dst", "moveme.jpg")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(ctx.rootPath, "ops-move-src", "moveme.jpg")),
    ).toBe(false);

    // The media cache directory moved with the id.
    const newCacheDir = await ctx.fileData.FileDataGetFileCacheDir(
      ctx.span,
      accountId,
      expectedId,
    );
    expect(fs.existsSync(path.join(newCacheDir, "thumbnail.webp"))).toBe(true);
    expect(fs.existsSync(path.join(oldCacheDir, "thumbnail.webp"))).toBe(false);

    // Source and target folder re-syncs are queued.
    const queuedFolderIds = queuedFolderSyncRows().map((row) =>
      JSON.parse(row.data).folderId,
    );
    expect(queuedFolderIds).toContain(source.id);
    expect(queuedFolderIds).toContain(target.id);
  });
});
