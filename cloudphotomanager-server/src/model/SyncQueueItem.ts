import { SyncQueueItemPriority } from "./SyncQueueItemPriority";
import { SyncQueueItemStatus } from "./SyncQueueItemStatus";

export interface SyncQueueItem {
  accountId: string;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  functionName: string;
  priority: SyncQueueItemPriority;
  status: SyncQueueItemStatus;
}
