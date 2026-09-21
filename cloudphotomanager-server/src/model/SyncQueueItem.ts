import { SyncQueueItemPriority } from "./SyncQueueItemPriority";
import { SyncQueueItemStatus } from "./SyncQueueItemStatus";

export interface SyncQueueItem {
  accountId: string;
  id: string;
  data: any;
  functionName: string;
  priority: SyncQueueItemPriority;
  status: SyncQueueItemStatus;
  fileIds?: string[];
}
