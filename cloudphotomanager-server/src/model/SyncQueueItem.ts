import { Account } from "./Account";
import { SyncQueueItemPriority } from "./SyncQueueItemPriority";
import { SyncQueueItemStatus } from "./SyncQueueItemStatus";
import { SyncQueueItemWeight } from "./SyncQueueItemWeight";

export interface SyncQueueItem {
  account: Account;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callbackExecution: any;
  priority: SyncQueueItemPriority;
  status: SyncQueueItemStatus;
  weight: SyncQueueItemWeight;
}
