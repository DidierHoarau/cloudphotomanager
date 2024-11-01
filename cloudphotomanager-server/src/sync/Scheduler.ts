import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { FolderData } from "../folders/FolderData";
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
  SyncInventoryInit(span, configIn);
  startSchedule();
  span.end();
}

export async function SchedulerStartAccountSync(context: Span, accountDefinition: AccountDefinition) {
  const span = StandardTracerStartSpan("Scheduler_startAccountSync", context);
  const account = await AccountFactory.getAccountImplementation(accountDefinition.id);

  // Ensure root folder
  const rootFolderCloud = await account.getFolderByPath(span, "/");
  const rootFolderKnown = await FolderData.get(span, rootFolderCloud.id);
  if (!rootFolderKnown) {
    rootFolderCloud.dateSync = new Date(0);
    await FolderData.add(span, rootFolderCloud);
    await SyncQueueQueueItem(
      account,
      rootFolderCloud.id,
      rootFolderCloud,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Outdated Folder
  for (const folder of await FolderData.getOlderThan(
    span,
    account.getAccountDefinition().id,
    new Date(new Date().getTime() - OUTDATED_AGE)
  )) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  // Top oldest sync folder
  for (const folder of await FolderData.getOldestSync(span, account.getAccountDefinition().id, 10)) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  // Top oldest sync files
  for (const folder of await FolderData.getNewstUpdate(span, account.getAccountDefinition().id, 10)) {
    await SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.NORMAL);
  }

  span.end();
}

// Private Functions

async function startSchedule() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const span = StandardTracerStartSpan("Scheduler_startSchedule");
    const accountDefinitions = await AccountData.list(span);
    accountDefinitions.forEach(async (accountDefinition) => {
      if (config.AUTO_SYNC) {
        SchedulerStartAccountSync(span, accountDefinition).catch((err) => {
          logger.error(err);
        });
      }
    });
    await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
  }
}
