import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { FolderData } from "../folders/FolderData";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";
import { SyncFileCache } from "./SyncFileCache";
import { SyncInventory } from "./SyncInventory";

let config: Config;

const OUTDATED_AGE = 7 * 24 * 3600 * 1000;

export class Scheduler {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    SyncFileCache.init(span, configIn);
    SyncInventory.init(span, configIn);
    Scheduler.startSchedule();
    span.end();
  }

  public static async startSchedule() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const span = StandardTracer.startSpan("Scheduler_startSchedule");
      const accountDefinitions = await AccountData.list(span);
      accountDefinitions.forEach(async (accountDefinition) => {
        Scheduler.startAccountSync(span, accountDefinition);
      });
      await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
    }
  }

  public static async startAccountSync(context: Span, accountDefinition: AccountDefinition) {
    const span = StandardTracer.startSpan("Scheduler_startAccountSync", context);
    const account = await AccountFactory.getAccountImplementation(accountDefinition);

    // Debug
    // FolderData.deleteAccount(span, accountDefinition.id);

    // // Ensure root folder
    const rootFolderCloud = await account.getFolderByPath(span, "/");
    const rootFolderKnown = await FolderData.getByCloudId(span, rootFolderCloud.accountId, rootFolderCloud.idCloud);
    if (!rootFolderKnown) {
      rootFolderCloud.dateSync = new Date(0);
      await FolderData.add(span, rootFolderCloud);
    }

    // Outdated Folder
    for (const folder of await FolderData.getOlderThan(
      span,
      account.getAccountDefinition().id,
      new Date(new Date().getTime() - OUTDATED_AGE)
    )) {
      await SyncInventory.syncFolder(span, account, folder);
    }

    // Top oldest sync folder
    for (const folder of await FolderData.getOldestSync(span, account.getAccountDefinition().id, 10)) {
      await SyncInventory.syncFolder(span, account, folder);
    }

    // Top oldest sync files
    for (const folder of await FolderData.getNewstUpdate(span, account.getAccountDefinition().id, 10)) {
      await SyncInventory.syncFolder(span, account, folder);
    }

    // Sync File Cache
    for (const folder of await FolderData.listForAccount(span, accountDefinition.id)) {
      await SyncFileCache.syncFolder(span, account, folder);
    }

    span.end();
  }
}
