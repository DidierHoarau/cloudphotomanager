import { reverse, sortBy, take } from "lodash";
import { SyncEvent } from "../model/SyncEvent";

let recentEvents: SyncEvent[] = [];

export async function SyncEventHistoryGetRecent(): Promise<SyncEvent[]> {
  return recentEvents;
}

export function SyncEventHistoryAdd(event: SyncEvent): void {
  recentEvents.push(event);
  recentEvents = take(reverse(sortBy(recentEvents, ["date"])), 10);
}
