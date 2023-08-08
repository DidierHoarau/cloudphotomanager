import * as _ from "lodash";
import { Account } from "../model/Account";
import { SyncQueueItem } from "../model/SyncQueueItem";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueItemStatus } from "../model/SyncQueueItemStatus";
import { Logger } from "../utils-std-ts/Logger";
import { Timeout } from "../utils-std-ts/Timeout";
import { SyncQueueItemWeight } from "../model/SyncQueueItemWeight";

let inProgressSyncCount = 0;
const MAX_PARALLEL_SYNC = 3;

const logger = new Logger("SyncQueue");
const queue: SyncQueueItem[] = [];

export class SyncQueue {
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getCounts(): any[] {
    return [
      { type: SyncQueueItemStatus.ACTIVE, count: _.filter(queue, { status: SyncQueueItemStatus.ACTIVE }).length },
      { type: SyncQueueItemStatus.WAITING, count: _.filter(queue, { status: SyncQueueItemStatus.WAITING }).length },
    ];
  }

  public static removeItem(id: string): void {
    const index = _.findIndex(queue, { id });
    if (index < 0) {
      return null;
    }
    queue.splice(index, 1);
  }

  public static queueItem(
    account: Account,
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callbackExecution: any,
    priority: SyncQueueItemPriority,
    weight: SyncQueueItemWeight
  ): void {
    const existingQueueditem = _.find(queue, { id });
    if (existingQueueditem) {
      if (existingQueueditem.priority > priority) {
        existingQueueditem.priority = priority;
      }
      return;
    }
    queue.push({ account, id, data, callbackExecution, priority, status: SyncQueueItemStatus.WAITING, weight });
    SyncQueue.processQueue();
  }

  private static async processQueue() {
    const hasHeavyTaskRunning =
      _.filter(queue, { status: SyncQueueItemStatus.ACTIVE, weight: SyncQueueItemWeight.HEAVY }).length > 0;
    if (
      inProgressSyncCount >= MAX_PARALLEL_SYNC ||
      _.filter(queue, { status: SyncQueueItemStatus.WAITING }).length === 0 ||
      (hasHeavyTaskRunning &&
        _.filter(queue, { status: SyncQueueItemStatus.WAITING, weight: SyncQueueItemWeight.LIGHT }).length === 0)
    ) {
      return;
    }
    inProgressSyncCount++;
    let syncItem;
    if (hasHeavyTaskRunning) {
      syncItem = _.sortBy(_.filter(queue, { status: SyncQueueItemStatus.WAITING, weight: SyncQueueItemWeight.LIGHT }), [
        "priority",
      ])[0];
    } else {
      syncItem = _.sortBy(_.filter(queue, { status: SyncQueueItemStatus.WAITING }), ["priority"])[0];
    }
    syncItem.status = SyncQueueItemStatus.ACTIVE;
    syncItem
      .callbackExecution(syncItem.account, syncItem.data)
      .catch((err) => {
        logger.error(err);
      })
      .finally(() => {
        const index = _.findIndex(queue, { id: syncItem.id });
        queue.splice(index, 1);
        inProgressSyncCount--;
        Timeout.wait(100);
        SyncQueue.processQueue();
      });
    Timeout.wait(100);
    SyncQueue.processQueue();
  }
}
