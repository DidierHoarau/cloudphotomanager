import * as _ from "lodash";
import { Account } from "../model/Account";
import { SyncQueueItem } from "../model/SyncQueueItem";
import { SyncQueueItemStatus } from "../model/SyncQueueItemStatus";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { PromisePool } from "../utils-std-ts/PromisePool";
import { OTelLogger } from "../OTelContext";

const MAX_PARALLEL_SYNC = 3;

const logger = OTelLogger().createModuleLogger("SyncQueue");
const queue: SyncQueueItem[] = [];

const promisePoolInteractive = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolNormal = new PromisePool(MAX_PARALLEL_SYNC, 3600 * 1000);
const promisePoolBatch = new PromisePool(1, 5 * 3600 * 1000);
let blockingOperations = 0;

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
}

export function SyncQueueQueueItem(
  account: Account,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callbackExecution: any,
  priority: SyncQueueItemPriority
): void {
  if (_.find(queue, { id })) {
    return;
  }
  const newQueueItem = {
    id,
    account,
    data,
    priority,
    status: SyncQueueItemStatus.WAITING,
    callbackExecution,
  };
  queue.push(newQueueItem);
  const itemProcess = async () => {
    newQueueItem.status = SyncQueueItemStatus.ACTIVE;
    await callbackExecution(account, data, priority)
      .catch((err) => {
        logger.error("Error Processing Queue Item", err);
      })
      .finally(() => {
        const index = _.findIndex(queue, { id });
        queue.splice(index, 1);
      });
  };

  if (priority === SyncQueueItemPriority.INTERACTIVE) {
    promisePoolInteractive.add(itemProcess);
  } else if (priority === SyncQueueItemPriority.BATCH) {
    promisePoolBatch.add(itemProcess);
  } else {
    promisePoolNormal.add(itemProcess);
  }
}
