import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { FolderData } from "../folders/FolderData";
import { AccountDefinition } from "../model/AccountDefinition";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";
import { SyncInventory } from "./SyncInventory";
import { SyncQueue } from "./SyncQueue";
import { SyncQueueItemWeight } from "../model/SyncQueueItemWeight";
import { Logger } from "../utils-std-ts/Logger";

const logger = new Logger("Scheduler");

let config: Config;

const OUTDATED_AGE = 7 * 24 * 3600 * 1000;

export class Scheduler {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    // SyncInventory.init(span, configIn);
    // Scheduler.startSchedule();
    span.end();
  }

  public static async startSchedule() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const span = StandardTracer.startSpan("Scheduler_startSchedule");
      const accountDefinitions = await AccountData.list(span);
      accountDefinitions.forEach(async (accountDefinition) => {
        if (config.AUTO_SYNC) {
          Scheduler.startAccountSync(span, accountDefinition).catch((err) => {
            logger.error(err);
          });
        }
      });
      await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
    }
  }

  public static async startAccountSync(context: Span, accountDefinition: AccountDefinition) {
    const span = StandardTracer.startSpan("Scheduler_startAccountSync", context);
    const account = await AccountFactory.getAccountImplementation(accountDefinition.id);

    // Debug
    // FolderData.deleteAccount(span, accountDefinition.id);

    // Ensure root folder
    const rootFolderCloud = await account.getFolderByPath(span, "/");
    const rootFolderKnown = await FolderData.get(span, rootFolderCloud.id);
    if (!rootFolderKnown) {
      rootFolderCloud.dateSync = new Date(0);
      await FolderData.add(span, rootFolderCloud);
      await SyncQueue.queueItem(
        account,
        rootFolderCloud.id,
        rootFolderCloud,
        SyncInventory.syncFolder,
        SyncQueueItemPriority.MEDIUM,
        SyncQueueItemWeight.LIGHT
      );
    }

    // Outdated Folder
    for (const folder of await FolderData.getOlderThan(
      span,
      account.getAccountDefinition().id,
      new Date(new Date().getTime() - OUTDATED_AGE)
    )) {
      await SyncQueue.queueItem(
        account,
        folder.id,
        folder,
        SyncInventory.syncFolder,
        SyncQueueItemPriority.MEDIUM,
        SyncQueueItemWeight.LIGHT
      );
    }

    // Top oldest sync folder
    for (const folder of await FolderData.getOldestSync(span, account.getAccountDefinition().id, 10)) {
      await SyncQueue.queueItem(
        account,
        folder.id,
        folder,
        SyncInventory.syncFolder,
        SyncQueueItemPriority.MEDIUM,
        SyncQueueItemWeight.LIGHT
      );
    }

    // Top oldest sync files
    for (const folder of await FolderData.getNewstUpdate(span, account.getAccountDefinition().id, 10)) {
      await SyncQueue.queueItem(
        account,
        folder.id,
        folder,
        SyncInventory.syncFolder,
        SyncQueueItemPriority.MEDIUM,
        SyncQueueItemWeight.LIGHT
      );
    }

    span.end();
  }
}
