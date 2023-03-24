import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";

const queue = {
  syncFileCache: [],
  syncInventory: [],
};

export class SyncQueue {
  //
  public static TYPE_SYNC_FILE_CACHE = "syncFileCache";
  public static TYPE_SYNC_INVENTORY = "syncInventory";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getCounts(): any[] {
    return [
      { type: SyncQueue.TYPE_SYNC_FILE_CACHE, count: queue.syncFileCache.length },
      { type: SyncQueue.TYPE_SYNC_INVENTORY, count: queue.syncInventory.length },
    ];
  }

  public static getCount(type: string): number {
    return queue[type].length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static pop(type: string): any {
    if (queue[type].length === 0) {
      return null;
    }
    return queue[type].pop().payload;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static popId(type: string, id: string): any {
    const index = _.findIndex(queue[type], { id });
    if (index < 0) {
      return null;
    }
    const paylod = queue[type][index];
    queue[type].splice(index, 1);
    return paylod;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static getId(type: string, id: string): any {
    const index = _.findIndex(queue[type], { id });
    if (index < 0) {
      return null;
    }
    const paylod = queue[type][index];
    return paylod;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static push(type: string, id: string, payload: any): void {
    if (_.find(queue[type], { id })) {
      return;
    }
    queue[type].push({ id, payload });
  }
}
