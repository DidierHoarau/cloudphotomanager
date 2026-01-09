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
import { SyncInventorySyncFolder } from "./SyncInventory";
import {
  syncVideoFromFull,
  syncPhotoFromFull,
  syncPhotoKeyWords,
  syncThumbnail,
  syncThumbnailFromVideoPreview,
} from "./SyncFileCache";

const MAX_PARALLEL_SYNC = 3;
const QUEUE_FILE_PATH = path.join(
  process.env.DATA_DIR || "/data",
  "sync-queue.json"
);

const logger = OTelLogger().createModuleLogger("SyncQueue");
const queue: SyncQueueItem[] = [];
type QueueFunction = (
  account: Account,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  priority: SyncQueueItemPriority
) => Promise<void>;
const functionRegistry = new Map<string, QueueFunction>();
const promisePoolInteractive = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolNormal = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolBatch = new PromisePool(1, 5 * 3600 * 1000);
let blockingOperations = 0;
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
    syncThumbnailFromVideoPreview
  );

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
    { type: "blocking", count: blockingOperations },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SyncQueueGetQueue(): any[] {
  return queue.map((item) => ({
    id: item.id,
    accountId: item.accountId,
    functionName: item.functionName,
    priority: item.priority,
    status: item.status,
    // Include relevant data fields if available
    dataInfo: item.data?.id
      ? {
          id: item.data.id,
          name: item.data.name || item.data.filename || item.data.folderpath,
        }
      : null,
  }));
}

export function SyncQueueSetBlockingOperationStart() {
  blockingOperations++;
}

export function SyncQueueSetBlockingOperationEnd() {
  blockingOperations--;
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
  priority: SyncQueueItemPriority
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
  };

  queue.push(newQueueItem);
  saveQueue();

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
        (item) => item.status === SyncQueueItemStatus.WAITING
      );

      if (waitingItems.length === 0) {
        break;
      }

      const interactiveItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.INTERACTIVE
      );
      const normalItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.NORMAL
      );
      const batchItems = waitingItems.filter(
        (item) => item.priority === SyncQueueItemPriority.BATCH
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
          await fn(
            await AccountFactoryGetAccountImplementation(item.accountId),
            item.data,
            item.priority
          )
            .catch((err) => {
              logger.error("Error Processing Queue Item", err);
            })
            .finally(() => {
              const index = _.findIndex(queue, { id: item.id });
              if (index >= 0) {
                queue.splice(index, 1);
                saveQueue();
              }
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

async function saveQueue(): Promise<void> {
  try {
    const serializableQueue = queue.map((item) => ({
      id: item.id,
      accountId: item.accountId,
      data: item.data,
      functionName: item.functionName,
      priority: item.priority,
      status: item.status,
    }));
    await fs.ensureDir(path.dirname(QUEUE_FILE_PATH));
    await fs.writeJSON(QUEUE_FILE_PATH, serializableQueue, { spaces: 2 });
  } catch (err) {
    logger.error("Error saving queue to file", err);
  }
}

function SyncQueueRegisterFunction(
  functionName: string,
  fn: QueueFunction
): void {
  functionRegistry.set(functionName, fn);
}
