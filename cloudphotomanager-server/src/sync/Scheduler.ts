import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDataList } from "../accounts/AccountData";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { Config } from "../Config";
import {
  FolderDataAdd,
  FolderDataGet,
  FolderDataGetNewestSync,
  FolderDataGetNewstUpdate,
  FolderDataGetOlderThan,
  FolderDataGetOldestSync,
} from "../folders/FolderData";
import { AccountDefinition } from "../model/AccountDefinition";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueueQueueItem } from "./SyncQueue";
import { SyncInventoryInit, SyncInventorySyncFolder } from "./SyncInventory";

const logger = new Logger("Scheduler");

let config: Config;

const OUTDATED_AGE = 7 * 24 * 3600 * 1000;

export async function SchedulerInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("Scheduler_init", context);
  config = configIn;
  SyncInventoryInit(span);
  startSchedule();
  span.end();
}

export async function SchedulerStartAccountSync(context: Span, accountDefinition: AccountDefinition) {
  const span = StandardTracerStartSpan("Scheduler_startAccountSync", context);
  const account = await AccountFactoryGetAccountImplementation(accountDefinition.id);

  // Ensure root folder
  const rootFolderCloud = await account.getFolderByPath(span, "/");
  const rootFolderKnown = await FolderDataGet(span, rootFolderCloud.id);
  if (!rootFolderKnown) {
    rootFolderCloud.dateSync = new Date(0);
    await FolderDataAdd(span, rootFolderCloud);
    await SyncQueueQueueItem(
      account,
      rootFolderCloud.id,
      rootFolderCloud,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Top Newest sync folder
  for (const folder of await FolderDataGetNewestSync(span, account.getAccountDefinition().id, 10)) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  // Top oldest sync folder
  for (const folder of await FolderDataGetOldestSync(span, account.getAccountDefinition().id, 10)) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  // Outdated Folder
  for (const folder of await FolderDataGetOlderThan(
    span,
    account.getAccountDefinition().id,
    new Date(new Date().getTime() - OUTDATED_AGE)
  )) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  // Top oldest sync files
  for (const folder of await FolderDataGetNewstUpdate(span, account.getAccountDefinition().id, 10)) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  span.end();
}

// Private Functions

async function startSchedule() {
  while (true) {
    const span = StandardTracerStartSpan("Scheduler_startSchedule");
    const accountDefinitions = await AccountDataList(span);
    accountDefinitions.forEach(async (accountDefinition) => {
      logger.info(`Start Sync of Account ${accountDefinition.name}`);
      SchedulerStartAccountSync(span, accountDefinition).catch((err) => {
        logger.error(err);
      });
    });
    await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
  }
}
