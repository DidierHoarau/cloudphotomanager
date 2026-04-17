import * as _ from "lodash";
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
import { FolderDataGet } from "../folders/FolderData";
import { SyncInventorySyncFolder } from "./SyncInventory";
import {
  syncVideoFromFull,
  syncPhotoFromFull,
  syncPhotoKeyWords,
  syncThumbnail,
  syncThumbnailFromVideoPreview,
} from "./SyncFileCache";
import { FileDataGet } from "../files/FileData";

const MAX_PARALLEL_SYNC = 3;
const QUEUE_FILE_PATH = path.join(
  process.env.DATA_DIR || "/data",
  "sync-queue.json",
);

const logger = OTelLogger().createModuleLogger("SyncQueue");
const queue: SyncQueueItem[] = [];
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

export async function SyncQueueInit(context: Span): Promise<void> {
  const span = OTelTracer().startSpan("SyncQueueInit", context);

  // Register all sync functions
  SyncQueueRegisterFunction("SyncInventorySyncFolder", SyncInventorySyncFolder);
  SyncQueueRegisterFunction("syncVideoFromFull", syncVideoFromFull);
  SyncQueueRegisterFunction("syncPhotoFromFull", syncPhotoFromFull);
  SyncQueueRegisterFunction("syncPhotoKeyWords", syncPhotoKeyWords);
  SyncQueueRegisterFunction("syncThumbnail", syncThumbnail);
  SyncQueueRegisterFunction(
    "syncThumbnailFromVideoPreview",
    syncThumbnailFromVideoPreview,
  );
  // Register blocking file operations
  SyncQueueRegisterFunction("fileDelete", fileDeleteOperation);
  SyncQueueRegisterFunction("folderMove", folderMoveOperation);
  SyncQueueRegisterFunction("fileRename", fileRenameOperation);

  if (await fs.pathExists(QUEUE_FILE_PATH)) {
    try {
      const serializableQueue = await fs.readJSON(QUEUE_FILE_PATH);
      for (const item of serializableQueue) {
        queue.push({
          id: item.id,
          accountId: item.accountId,
          data: item.data,
          functionName: item.functionName,
          priority: item.priority,
          status: SyncQueueItemStatus.WAITING,
        });
      }
    } catch (err) {
      logger.error("Error reading queue file during init", err);
      await fs.remove(QUEUE_FILE_PATH);
      logger.info("Corrupted queue file removed");
    }
  }

  processQueue();

  span.end();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SyncQueueGetCounts(): any[] {
  return [
    {
      type: SyncQueueItemStatus.ACTIVE,
      count: _.filter(queue, { status: SyncQueueItemStatus.ACTIVE }).length,
    },
    {
      type: SyncQueueItemStatus.WAITING,
      count: _.filter(queue, { status: SyncQueueItemStatus.WAITING }).length,
    },
  ];
}

export function SyncQueueGetProcessingFileIds(): string[] {
  const ids: string[] = [];
  for (const item of queue) {
    if (item.fileIds) {
      for (const fid of item.fileIds) {
        ids.push(fid);
      }
    }
  }
  return ids;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveItemLabel(item: SyncQueueItem): string | null {
  const d = item.data;
  if (!d) return null;
  // Standard single-item data (e.g. SyncInventory, SyncFileCache)
  if (d.id) {
    return d.name || d.filename || d.folderpath || d.id;
  }
  // Interactive file operations: fileIdList (delete / move)
  if (d.fileIdList && Array.isArray(d.fileIdList)) {
    const count = d.fileIdList.length;
    if (item.functionName === "fileDelete") {
      return count === 1 ? `Delete 1 file` : `Delete ${count} files`;
    }
    if (item.functionName === "folderMove") {
      const dest = d.folderpath ? ` → ${d.folderpath}` : "";
      return count === 1 ? `Move 1 file${dest}` : `Move ${count} files${dest}`;
    }
  }
  // Interactive file operations: fileIdNames (rename)
  if (d.fileIdNames && Array.isArray(d.fileIdNames)) {
    const count = d.fileIdNames.length;
    if (count === 1) {
      return `Rename: ${d.fileIdNames[0].filename || d.fileIdNames[0].id}`;
    }
    return `Rename ${count} files`;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SyncQueueGetQueue(): any[] {
  return queue.map((item) => ({
    id: item.id,
    accountId: item.accountId,
    functionName: item.functionName,
    priority: item.priority,
    status: item.status,
    fileIds: item.fileIds || [],
    label: resolveItemLabel(item),
  }));
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
  const index = _.findIndex(queue, { id });
  if (index < 0) {
    return null;
  }
  queue.splice(index, 1);
  saveQueue(); // Save after removing item
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
  if (_.find(queue, { id })) {
    return;
  }

  const newQueueItem: SyncQueueItem = {
    id,
    accountId,
    data,
    functionName,
    priority,
    status: SyncQueueItemStatus.WAITING,
    fileIds: fileIds || [],
  };

  queue.push(newQueueItem);
  saveQueue();
  broadcastQueueUpdate();

  processQueue();
}

// Private Functions

async function processQueue(): Promise<void> {
  if (queueProcessorRunning) {
    return;
  }

  queueProcessorRunning = true;

  try {
    while (queue.length > 0) {
      const waitingItems = queue.filter(
        (item) => item.status === SyncQueueItemStatus.WAITING,
      );

      if (waitingItems.length === 0) {
        break;
      }

      const interactiveItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.INTERACTIVE,
      );
      const normalItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.NORMAL,
      );
      const batchItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.BATCH,
      );

      const itemsToProcess: SyncQueueItem[] = [];

      if (
        interactiveItems.length > 0 &&
        promisePoolInteractive.getAvailableSlots() > 0
      ) {
        itemsToProcess.push(interactiveItems[0]);
      }

      if (normalItems.length > 0 && promisePoolNormal.getAvailableSlots() > 0) {
        itemsToProcess.push(normalItems[0]);
      }

      if (batchItems.length > 0 && promisePoolBatch.getAvailableSlots() > 0) {
        itemsToProcess.push(batchItems[0]);
      }

      if (itemsToProcess.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      for (const item of itemsToProcess) {
        const fn = functionRegistry.get(item.functionName);

        if (!fn) {
          logger.error(`Function ${item.functionName} not registered in queue`);
          const index = _.findIndex(queue, { id: item.id });
          queue.splice(index, 1);
          continue;
        }

        const itemProcess = async () => {
          item.status = SyncQueueItemStatus.ACTIVE;
          await saveQueue();
          broadcastQueueUpdate();
          await fn(
            await AccountFactoryGetAccountImplementation(item.accountId),
            item.data,
            item.priority,
          )
            .catch((err) => {
              logger.error("Error Processing Queue Item", err);
            })
            .finally(() => {
              const completedItem = _.find(queue, { id: item.id });
              const completedFileIds = completedItem?.fileIds || [];
              const completedFunctionName = item.functionName;
              const completedPriority = item.priority;
              const index = _.findIndex(queue, { id: item.id });
              if (index >= 0) {
                queue.splice(index, 1);
                saveQueue();
              }
              broadcastOperationComplete(
                completedFunctionName,
                completedFileIds,
                completedPriority,
              );
              broadcastQueueUpdate();
            });
        };

        if (item.priority === SyncQueueItemPriority.INTERACTIVE) {
          promisePoolInteractive.add(itemProcess);
        } else if (item.priority === SyncQueueItemPriority.BATCH) {
          promisePoolBatch.add(itemProcess);
        } else {
          promisePoolNormal.add(itemProcess);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    queueProcessorRunning = false;
  }
}

function broadcastQueueUpdate(): void {
  if (!broadcastFn) return;
  broadcastFn({
    type: "queue_update",
    counts: SyncQueueGetCounts(),
    processingFileIds: SyncQueueGetProcessingFileIds(),
    items: SyncQueueGetQueue(),
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

async function saveQueue(): Promise<void> {
  try {
    const serializableQueue = queue.map((item) => ({
      id: item.id,
      accountId: item.accountId,
      data: item.data,
      functionName: item.functionName,
      priority: item.priority,
      status: item.status,
      fileIds: item.fileIds || [],
    }));
    await fs.ensureDir(path.dirname(QUEUE_FILE_PATH));
    await fs.writeJSON(QUEUE_FILE_PATH, serializableQueue, { spaces: 2 });
  } catch (err) {
    logger.error("Error saving queue to file", err);
  }
}

function SyncQueueRegisterFunction(
  functionName: string,
  fn: QueueFunction,
): void {
  functionRegistry.set(functionName, fn);
}

// Blocking file operation implementations

async function fileDeleteOperation(
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  const spanSubProcess = OTelTracer().startSpan("fileDeleteOperation");
  try {
    let folderId = "";
    for (const fileId of data.fileIdList as string[]) {
      const file = await FileDataGet(spanSubProcess, fileId);
      if (!file) {
        continue;
      }
      folderId = file.folderId;
      logger.info(
        `Delete file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename}`,
        spanSubProcess,
      );
      await account.deleteFile(spanSubProcess, file);
    }
    if (folderId) {
      const folder = await FolderDataGet(spanSubProcess, folderId);
      await SyncInventorySyncFolder(account, folder);
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
    let initialFolderId = "";
    for (const fileId of data.fileIdList as string[]) {
      const file = await FileDataGet(spanSubProcess, fileId);
      if (!file) {
        continue;
      }
      initialFolderId = file.folderId;
      logger.info(
        `Moving file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename} to ${data.folderpath}`,
        spanSubProcess,
      );
      await account.moveFile(spanSubProcess, file, data.folderpath);
    }
    if (initialFolderId) {
      const initialFolder = await FolderDataGet(
        spanSubProcess,
        initialFolderId,
      );
      await SyncInventorySyncFolder(account, initialFolder);
    }
    const targetFolder = await account.getFolderByPath(
      spanSubProcess,
      data.folderpath,
    );
    if (targetFolder) {
      await SyncInventorySyncFolder(account, targetFolder);
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
    let folderId = "";
    for (const fileIdName of data.fileIdNames as {
      id: string;
      filename: string;
    }[]) {
      const file = await FileDataGet(spanSubProcess, fileIdName.id);
      if (!file) {
        continue;
      }
      folderId = file.folderId;
      logger.info(
        `Rename file: ${account.getAccountDefinition().id}: ${file.id} ${file.filename} to ${fileIdName.filename}`,
        spanSubProcess,
      );
      await account.renameFile(spanSubProcess, file, fileIdName.filename);
    }
    if (folderId) {
      const folder = await FolderDataGet(spanSubProcess, folderId);
      await SyncInventorySyncFolder(account, folder);
    }
  } catch (err) {
    logger.error("Error in fileRenameOperation", err, spanSubProcess);
  } finally {
    spanSubProcess.end();
  }
}
