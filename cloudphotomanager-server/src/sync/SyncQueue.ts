import * as fs from "fs-extra";
import * as path from "path";
import { Account } from "../model/Account";
import { SyncQueueItem } from "../model/SyncQueueItem";
import { SyncQueueItemStatus } from "../model/SyncQueueItemStatus";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { PromisePool } from "../utils-std-ts/PromisePool";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import {
  FolderDataAdd,
  FolderDataGet,
  FolderDataGetParent,
} from "../folders/FolderData";
import { SyncInventorySyncFolder } from "./SyncInventory";
import {
  syncVideoFromFull,
  syncPhotoFromFull,
  syncPhotoKeyWords,
  syncThumbnail,
  syncThumbnailFromVideoPreview,
  SyncFileCacheCheckFile,
  SyncFileCacheRemoveFile,
} from "./SyncFileCache";
import { FileDataGet, FileDataUpdateKeywords } from "../files/FileData";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";

const MAX_PARALLEL_SYNC = 3;
const LEGACY_QUEUE_FILE_PATH = path.join(
  process.env.DATA_DIR || "/data",
  "sync-queue.json",
);
const BROADCAST_DEBOUNCE_MS = 500;
const QUEUE_ITEMS_BROADCAST_LIMIT = 200;

const logger = OTelLogger().createModuleLogger("SyncQueue");

type QueueFunction = (
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  priority: SyncQueueItemPriority,
) => Promise<void>;

const functionRegistry = new Map<string, QueueFunction>();
const promisePoolInteractive = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolNormal = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolBatch = new PromisePool(1, 5 * 3600 * 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BroadcastFn = (message: any) => void;
let broadcastFn: BroadcastFn | null = null;
let queueProcessorRunning = false;

// O(1) set of fileIds currently referenced by any queue row (waiting or
// active). Kept in sync with the DB through enqueue/dequeue paths so the
// websocket broadcast never has to scan the full table.
const queuedFileIdRefCount = new Map<string, number>();

let broadcastTimer: NodeJS.Timeout | null = null;
let broadcastPending = false;

export async function SyncQueueInit(context: Span): Promise<void> {
  const span = OTelTracer().startSpan("SyncQueueInit", context);

  // Register all sync functions. Handlers receive slim payloads (IDs) and
  // reload the full File/Folder from the DB at dispatch time so queue rows
  // stay small.
  SyncQueueRegisterFunction(
    "SyncInventorySyncFolder",
    async (account, data, priority) => {
      const loadSpan = OTelTracer().startSpan("SyncQueueLoadFolder");
      const folder = await FolderDataGet(loadSpan, data.folderId);
      loadSpan.end();
      if (!folder) {
        logger.info(
          `Folder ${data.folderId} not found, skipping SyncInventorySyncFolder`,
        );
        return;
      }
      await SyncInventorySyncFolder(account, folder, priority);
    },
  );
  SyncQueueRegisterFunction("syncVideoFromFull", async (account, data) => {
    const loadSpan = OTelTracer().startSpan("SyncQueueLoadFile");
    const file = await FileDataGet(loadSpan, data.fileId);
    loadSpan.end();
    if (!file) {
      logger.info(`File ${data.fileId} not found, skipping syncVideoFromFull`);
      return;
    }
    await syncVideoFromFull(account, file);
  });
  SyncQueueRegisterFunction("syncPhotoFromFull", async (account, data) => {
    const loadSpan = OTelTracer().startSpan("SyncQueueLoadFile");
    const file = await FileDataGet(loadSpan, data.fileId);
    loadSpan.end();
    if (!file) {
      logger.info(`File ${data.fileId} not found, skipping syncPhotoFromFull`);
      return;
    }
    await syncPhotoFromFull(account, file);
  });
  SyncQueueRegisterFunction("syncPhotoKeyWords", async (account, data) => {
    const loadSpan = OTelTracer().startSpan("SyncQueueLoadFile");
    const file = await FileDataGet(loadSpan, data.fileId);
    loadSpan.end();
    if (!file) {
      logger.info(`File ${data.fileId} not found, skipping syncPhotoKeyWords`);
      return;
    }
    await syncPhotoKeyWords(account, file);
  });
  SyncQueueRegisterFunction("syncThumbnail", async (account, data) => {
    const loadSpan = OTelTracer().startSpan("SyncQueueLoadFile");
    const file = await FileDataGet(loadSpan, data.fileId);
    loadSpan.end();
    if (!file) {
      logger.info(`File ${data.fileId} not found, skipping syncThumbnail`);
      return;
    }
    await syncThumbnail(account, file);
  });
  SyncQueueRegisterFunction(
    "syncThumbnailFromVideoPreview",
    async (account, data) => {
      const loadSpan = OTelTracer().startSpan("SyncQueueLoadFile");
      const file = await FileDataGet(loadSpan, data.fileId);
      loadSpan.end();
      if (!file) {
        logger.info(
          `File ${data.fileId} not found, skipping syncThumbnailFromVideoPreview`,
        );
        return;
      }
      await syncThumbnailFromVideoPreview(account, file);
    },
  );
  // Individual file operations already use slim payloads
  SyncQueueRegisterFunction("fileDelete", fileDeleteOperation);
  SyncQueueRegisterFunction("folderMove", folderMoveOperation);
  SyncQueueRegisterFunction("fileRename", fileRenameOperation);
  SyncQueueRegisterFunction("fileCacheRebuild", fileCacheRebuildOperation);

  // One-time migration of the legacy JSON-file queue into the DB.
  if (await fs.pathExists(LEGACY_QUEUE_FILE_PATH)) {
    try {
      const legacy = await fs.readJSON(LEGACY_QUEUE_FILE_PATH);
      const now = new Date().toISOString();
      for (const item of legacy) {
        const slimData = slimLegacyData(item.functionName, item.data);
        SqlDbUtilsExecSQL(
          span,
          "INSERT OR IGNORE INTO sync_queue " +
            "(id, accountId, functionName, priority, status, data, fileIds, dateCreated) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            item.id,
            item.accountId,
            item.functionName,
            item.priority,
            SyncQueueItemStatus.WAITING,
            JSON.stringify(slimData),
            JSON.stringify(item.fileIds || []),
            now,
          ],
        );
      }
      await fs.remove(LEGACY_QUEUE_FILE_PATH);
      logger.info(
        `Migrated ${legacy.length} legacy queue items into DB; sync-queue.json removed`,
        span,
      );
    } catch (err) {
      logger.error("Error migrating legacy sync-queue.json", err, span);
      await fs.remove(LEGACY_QUEUE_FILE_PATH).catch(() => {
        /* ignore */
      });
    }
  }

  // Crash recovery: any rows stuck in ACTIVE at startup must be retried.
  SqlDbUtilsExecSQL(span, "UPDATE sync_queue SET status = ? WHERE status = ?", [
    SyncQueueItemStatus.WAITING,
    SyncQueueItemStatus.ACTIVE,
  ]);

  // Rebuild the in-memory fileId ref-count from persisted rows.
  queuedFileIdRefCount.clear();
  const rows = SqlDbUtilsQuerySQL(
    span,
    "SELECT fileIds FROM sync_queue WHERE fileIds IS NOT NULL AND fileIds != '[]'",
  );
  for (const row of rows) {
    const ids = safeParseStringArray(row.fileIds);
    for (const fid of ids) incrementFileIdRef(fid);
  }

  processQueue();

  span.end();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SyncQueueGetCounts(): any[] {
  const rows = SqlDbUtilsQuerySQL(
    OTelTracer().startSpan("SyncQueueGetCounts"),
    "SELECT status, COUNT(*) as c FROM sync_queue GROUP BY status",
  );
  let active = 0;
  let waiting = 0;
  for (const row of rows) {
    if (row.status === SyncQueueItemStatus.ACTIVE) active = row.c;
    else if (row.status === SyncQueueItemStatus.WAITING) waiting = row.c;
  }
  return [
    { type: SyncQueueItemStatus.ACTIVE, count: active },
    { type: SyncQueueItemStatus.WAITING, count: waiting },
  ];
}

export function SyncQueueGetBatchWaitingCount(): number {
  const rows = SqlDbUtilsQuerySQL(
    OTelTracer().startSpan("SyncQueueGetBatchWaitingCount"),
    "SELECT COUNT(*) as c FROM sync_queue WHERE priority = ? AND status = ?",
    [SyncQueueItemPriority.BATCH, SyncQueueItemStatus.WAITING],
  );
  return rows.length > 0 ? rows[0].c : 0;
}

export function SyncQueueGetProcessingFileIds(): string[] {
  return Array.from(queuedFileIdRefCount.keys());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SyncQueueGetQueue(): any[] {
  const rows = SqlDbUtilsQuerySQL(
    OTelTracer().startSpan("SyncQueueGetQueue"),
    "SELECT id, accountId, functionName, priority, status, data, fileIds " +
      "FROM sync_queue " +
      "ORDER BY status DESC, priority ASC, dateCreated ASC LIMIT ?",
    [QUEUE_ITEMS_BROADCAST_LIMIT],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => {
    const item = rowToItem(row);
    return {
      id: item.id,
      accountId: item.accountId,
      functionName: item.functionName,
      priority: item.priority,
      status: item.status,
      fileIds: item.fileIds || [],
      label: resolveItemLabel(item),
    };
  });
}

// Kept as no-ops for backward compatibility
export function SyncQueueSetBlockingOperationStart() {
  // no-op: operations now go through the queue
}

export function SyncQueueSetBlockingOperationEnd() {
  // no-op: operations now go through the queue
}

export function SyncQueueRegisterBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export function SyncQueueRemoveItem(id: string): void {
  const span = OTelTracer().startSpan("SyncQueueRemoveItem");
  const existing = SqlDbUtilsQuerySQL(
    span,
    "SELECT fileIds FROM sync_queue WHERE id = ?",
    [id],
  );
  if (existing.length === 0) {
    span.end();
    return;
  }
  SqlDbUtilsExecSQL(span, "DELETE FROM sync_queue WHERE id = ?", [id]);
  for (const fid of safeParseStringArray(existing[0].fileIds)) {
    decrementFileIdRef(fid);
  }
  scheduleBroadcastQueueUpdate();
  span.end();
}

export function SyncQueueQueueItem(
  accountId: string,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  functionName: string,
  priority: SyncQueueItemPriority,
  fileIds?: string[],
): void {
  const span = OTelTracer().startSpan("SyncQueueQueueItem");
  const existing = SqlDbUtilsQuerySQL(
    span,
    "SELECT 1 FROM sync_queue WHERE id = ? LIMIT 1",
    [id],
  );
  if (existing.length > 0) {
    span.end();
    return;
  }

  const fileIdsArr = fileIds || [];
  SqlDbUtilsExecSQL(
    span,
    "INSERT OR IGNORE INTO sync_queue " +
      "(id, accountId, functionName, priority, status, data, fileIds, dateCreated) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      accountId,
      functionName,
      priority,
      SyncQueueItemStatus.WAITING,
      JSON.stringify(data ?? {}),
      JSON.stringify(fileIdsArr),
      new Date().toISOString(),
    ],
  );

  for (const fid of fileIdsArr) incrementFileIdRef(fid);

  scheduleBroadcastQueueUpdate();
  span.end();

  processQueue();
}

// Private Functions

async function processQueue(): Promise<void> {
  if (queueProcessorRunning) {
    return;
  }

  queueProcessorRunning = true;

  try {
    while (true) {
      const dispatched = dispatchNextBatch();

      if (dispatched === 0) {
        const waitingRow = SqlDbUtilsQuerySQL(
          OTelTracer().startSpan("SyncQueueProcessCheckWaiting"),
          "SELECT 1 FROM sync_queue WHERE status = ? LIMIT 1",
          [SyncQueueItemStatus.WAITING],
        );
        if (waitingRow.length === 0) {
          break;
        }
        // Pools are full or nothing matches; wait before retrying.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    queueProcessorRunning = false;
  }
}

function dispatchNextBatch(): number {
  let dispatched = 0;
  const priorities: {
    pool: PromisePool;
    priority: SyncQueueItemPriority;
  }[] = [
    {
      pool: promisePoolInteractive,
      priority: SyncQueueItemPriority.INTERACTIVE,
    },
    { pool: promisePoolNormal, priority: SyncQueueItemPriority.NORMAL },
    { pool: promisePoolBatch, priority: SyncQueueItemPriority.BATCH },
  ];

  for (const { pool, priority } of priorities) {
    if (pool.getAvailableSlots() <= 0) continue;

    const span = OTelTracer().startSpan("SyncQueueDispatchNext");
    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM sync_queue WHERE status = ? AND priority = ? " +
        "ORDER BY dateCreated ASC LIMIT 1",
      [SyncQueueItemStatus.WAITING, priority],
    );
    if (rows.length === 0) {
      span.end();
      continue;
    }
    const item = rowToItem(rows[0]);
    SqlDbUtilsExecSQL(span, "UPDATE sync_queue SET status = ? WHERE id = ?", [
      SyncQueueItemStatus.ACTIVE,
      item.id,
    ]);
    span.end();

    dispatchItem(pool, item);
    dispatched++;
  }

  if (dispatched > 0) {
    scheduleBroadcastQueueUpdate();
  }

  return dispatched;
}

function dispatchItem(pool: PromisePool, item: SyncQueueItem): void {
  const fn = functionRegistry.get(item.functionName);
  if (!fn) {
    logger.error(`Function ${item.functionName} not registered in queue`);
    const span = OTelTracer().startSpan("SyncQueueDropUnknown");
    SqlDbUtilsExecSQL(span, "DELETE FROM sync_queue WHERE id = ?", [item.id]);
    for (const fid of item.fileIds || []) decrementFileIdRef(fid);
    span.end();
    return;
  }

  const itemProcess = async () => {
    try {
      const account = await AccountFactoryGetAccountImplementation(
        item.accountId,
      );
      await fn(account, item.data, item.priority);
    } catch (err) {
      logger.error("Error Processing Queue Item", err);
    } finally {
      const span = OTelTracer().startSpan("SyncQueueItemComplete");
      SqlDbUtilsExecSQL(span, "DELETE FROM sync_queue WHERE id = ?", [item.id]);
      span.end();
      for (const fid of item.fileIds || []) decrementFileIdRef(fid);
      broadcastOperationComplete(
        item.functionName,
        item.fileIds || [],
        item.priority,
      );
      scheduleBroadcastQueueUpdate();
      // Ensure the processor keeps draining even after idle periods.
      processQueue();
    }
  };

  pool.add(itemProcess);
}

function scheduleBroadcastQueueUpdate(): void {
  if (!broadcastFn) return;
  if (broadcastTimer) {
    broadcastPending = true;
    return;
  }
  emitBroadcastQueueUpdate();
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (broadcastPending) {
      broadcastPending = false;
      scheduleBroadcastQueueUpdate();
    }
  }, BROADCAST_DEBOUNCE_MS);
}

function emitBroadcastQueueUpdate(): void {
  if (!broadcastFn) return;
  const counts = SyncQueueGetCounts();
  const items = SyncQueueGetQueue();
  const totalItems = counts.reduce((sum, c) => sum + (c.count || 0), 0);
  broadcastFn({
    type: "queue_update",
    counts,
    processingFileIds: SyncQueueGetProcessingFileIds(),
    items,
    totalItems,
    truncated: items.length < totalItems,
  });
}

function broadcastOperationComplete(
  operationName: string,
  fileIds: string[],
  priority: SyncQueueItemPriority,
): void {
  if (!broadcastFn) return;
  broadcastFn({
    type: "operation_complete",
    operationName,
    fileIds,
    priority,
  });
}

function SyncQueueRegisterFunction(
  functionName: string,
  fn: QueueFunction,
): void {
  functionRegistry.set(functionName, fn);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToItem(row: any): SyncQueueItem {
  let data: unknown = {};
  try {
    data = row.data ? JSON.parse(row.data) : {};
  } catch {
    data = {};
  }
  return {
    id: row.id,
    accountId: row.accountId,
    functionName: row.functionName,
    priority: row.priority,
    status: row.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
    fileIds: safeParseStringArray(row.fileIds),
  };
}

function safeParseStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === "string");
    }
  } catch {
    /* ignore */
  }
  return [];
}

function incrementFileIdRef(fileId: string): void {
  if (!fileId) return;
  const current = queuedFileIdRefCount.get(fileId) || 0;
  queuedFileIdRefCount.set(fileId, current + 1);
}

function decrementFileIdRef(fileId: string): void {
  if (!fileId) return;
  const current = queuedFileIdRefCount.get(fileId) || 0;
  if (current <= 1) {
    queuedFileIdRefCount.delete(fileId);
  } else {
    queuedFileIdRefCount.set(fileId, current - 1);
  }
}

function resolveItemLabel(item: SyncQueueItem): string | null {
  const d = item.data;
  if (!d) return null;
  if (d.fileId) {
    if (item.functionName === "fileDelete") {
      return `Delete: ${d.fileId}`;
    }
    if (item.functionName === "folderMove") {
      const dest = d.folderpath ? ` → ${d.folderpath}` : "";
      return `Move: ${d.fileId}${dest}`;
    }
    if (item.functionName === "fileRename") {
      return `Rename: ${d.filename || d.fileId}`;
    }
    if (item.functionName === "fileCacheRebuild") {
      return `Rebuild cache: ${d.fileId}`;
    }
    return `${item.functionName}: ${d.fileId}`;
  }
  if (d.folderId) {
    return `Folder: ${d.folderId}`;
  }
  // Legacy payloads may still contain the full File/Folder object.
  if (d.id) {
    return d.name || d.filename || d.folderpath || d.id;
  }
  return null;
}

function slimLegacyData(
  functionName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!data || typeof data !== "object") return data;
  // Folder-based sync functions
  if (functionName === "SyncInventorySyncFolder") {
    if (data.folderId) return { folderId: data.folderId };
    if (data.id) return { folderId: data.id };
    return data;
  }
  // File-based sync functions
  if (
    functionName === "syncVideoFromFull" ||
    functionName === "syncPhotoFromFull" ||
    functionName === "syncPhotoKeyWords" ||
    functionName === "syncThumbnail" ||
    functionName === "syncThumbnailFromVideoPreview"
  ) {
    if (data.fileId) return { fileId: data.fileId };
    if (data.id) return { fileId: data.id };
    return data;
  }
  // fileDelete / folderMove / fileRename / fileCacheRebuild already use fileId
  return data;
}

// Individual file operation implementations

async function fileDeleteOperation(
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  const spanSubProcess = OTelTracer().startSpan("fileDeleteOperation");
  try {
    const file = await FileDataGet(spanSubProcess, data.fileId as string);
    if (file) {
      logger.info(
        `Delete file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename}`,
        spanSubProcess,
      );
      const folderId = file.folderId;
      await account.deleteFile(spanSubProcess, file);
      const folder = await FolderDataGet(spanSubProcess, folderId);
      if (folder) {
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          folder.id,
          { folderId: folder.id },
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.INTERACTIVE,
        );
      }
    }
  } catch (err) {
    logger.error("Error in fileDeleteOperation", err, spanSubProcess);
  } finally {
    spanSubProcess.end();
  }
}

async function folderMoveOperation(
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  const spanSubProcess = OTelTracer().startSpan("folderMoveOperation");
  try {
    const file = await FileDataGet(spanSubProcess, data.fileId as string);
    if (file) {
      const initialFolderId = file.folderId;
      logger.info(
        `Moving file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename} to ${data.folderpath}`,
        spanSubProcess,
      );
      await account.moveFile(spanSubProcess, file, data.folderpath);

      // Re-sync the source folder
      const initialFolder = await FolderDataGet(
        spanSubProcess,
        initialFolderId,
      );
      if (initialFolder) {
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          initialFolder.id,
          { folderId: initialFolder.id },
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.INTERACTIVE,
        );
      }

      // Get (or create) the target folder in the local DB, then re-sync it
      // and also queue a re-sync of its parent so the parent discovers the new child
      const targetFolderCloud = await account.getFolderByPath(
        spanSubProcess,
        data.folderpath,
      );
      if (targetFolderCloud) {
        let targetFolderDb = await FolderDataGet(
          spanSubProcess,
          targetFolderCloud.id,
        );
        if (!targetFolderDb) {
          // New folder — persist it so SyncInventorySyncFolder can run on it
          targetFolderCloud.dateSync = new Date(0);
          await FolderDataAdd(spanSubProcess, targetFolderCloud);
          targetFolderDb = targetFolderCloud;
        }
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          targetFolderDb.id,
          { folderId: targetFolderDb.id },
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.INTERACTIVE,
        );
        // Queue the parent of the target folder so it picks up the new subfolder
        const targetParent = await FolderDataGetParent(
          spanSubProcess,
          targetFolderDb.id,
        );
        if (targetParent) {
          SyncQueueQueueItem(
            account.getAccountDefinition().id,
            targetParent.id,
            { folderId: targetParent.id },
            "SyncInventorySyncFolder",
            SyncQueueItemPriority.INTERACTIVE,
          );
        }
      }
    }
  } catch (err) {
    logger.error("Error in folderMoveOperation", err, spanSubProcess);
  } finally {
    spanSubProcess.end();
  }
}

async function fileRenameOperation(
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  const spanSubProcess = OTelTracer().startSpan("fileRenameOperation");
  try {
    const file = await FileDataGet(spanSubProcess, data.fileId as string);
    if (file) {
      logger.info(
        `Rename file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename} to ${data.filename}`,
        spanSubProcess,
      );
      await account.renameFile(spanSubProcess, file, data.filename);
      const folder = await FolderDataGet(spanSubProcess, file.folderId);
      if (folder) {
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          folder.id,
          { folderId: folder.id },
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.INTERACTIVE,
        );
      }
    }
  } catch (err) {
    logger.error("Error in fileRenameOperation", err, spanSubProcess);
  } finally {
    spanSubProcess.end();
  }
}

async function fileCacheRebuildOperation(
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  const spanSubProcess = OTelTracer().startSpan("fileCacheRebuildOperation");
  try {
    const file = await FileDataGet(spanSubProcess, data.fileId as string);
    if (file) {
      logger.info(
        `Rebuild cache: ${account.getAccountDefinition().id}: ${file.id} ${file.filename}`,
        spanSubProcess,
      );
      await SyncFileCacheRemoveFile(spanSubProcess, account, file);
      // Reset keywords so syncPhotoKeyWords is re-queued to re-extract EXIF
      file.keywords = null;
      await FileDataUpdateKeywords(spanSubProcess, file);
      SyncFileCacheCheckFile(spanSubProcess, account, file);
    }
  } catch (err) {
    logger.error("Error in fileCacheRebuildOperation", err, spanSubProcess);
  } finally {
    spanSubProcess.end();
  }
}
