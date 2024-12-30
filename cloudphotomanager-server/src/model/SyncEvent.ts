import { SyncEventActions } from "./SyncEventActions";

export interface SyncEvent {
  objectType: string;
  objectId: string;
  accountId: string;
  date: Date;
  action: SyncEventActions;
}
