import { SyncEventActions } from "./SyncEventActions";

export interface SyncEvent {
  objectType: string;
  objectId: string;
  date: Date;
  action: SyncEventActions;
}
