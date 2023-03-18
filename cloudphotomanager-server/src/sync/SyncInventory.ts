import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import * as _ from "lodash";
import { SyncQueue } from "./SyncQueue";
import { Timeout } from "../utils-std-ts/Timeout";
import { FolderData } from "../files/FolderData";
import { Folder } from "../model/Folder";

let config: Config;
const logger = new Logger("SyncInventory");

export class SyncInventory {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_init", context);
    config = configIn;
    span.end();
  }

  public static async startSync(context: Span, account: Account): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_startSync", context);
    const cloudFolders = await account.listFolders(span);
    const knownFolders = await FolderData.listForAccount(span, account.getAccountDefinition().id);
    for (const knownFolder of knownFolders) {
      if (!_.find(cloudFolders, { folderpath: knownFolder.folderpath })) {
        logger.info(`Folder removed for ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`);
        FolderData.deleteForAccount(span, account.getAccountDefinition().id, knownFolder.folderpath);
      }
    }
    for (const cloudFolder of cloudFolders) {
      SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, cloudFolder.folderpath, { folder: cloudFolder, account });
      await Timeout.wait(1);
    }
    span.end();
    await Timeout.wait(1);
    SyncInventory.processQueue();
  }

  private static async processQueue() {
    const queuedItem = SyncQueue.pop(SyncQueue.TYPE_SYNC_INVENTORY);
    if (!queuedItem) {
      return;
    }
    const span = StandardTracer.startSpan("SyncInventory_processQueue");

    try {
      const account: Account = queuedItem.account;
      const folder: Folder = queuedItem.folder;
      const cloudFiles = await account.listFileInFolders(span, folder);
      const knownFiles = await FileData.listAccountFolder(span, account.getAccountDefinition().id, folder.folderpath);
      const syncSummary = { dateStarted: new Date(), added: 0, updated: 0, deleted: 0 };
      for (const cloudFile of cloudFiles) {
        const knownFile = _.find(knownFiles, { folderpath: cloudFile.folderpath, filename: cloudFile.filename });
        if (!knownFile) {
          syncSummary.added++;
          await FileData.add(span, cloudFile);
        } else if (
          knownFile.dateMedia.getTime() !== cloudFile.dateMedia.getTime() ||
          knownFile.dateUpdated.getTime() !== cloudFile.dateUpdated.getTime() ||
          knownFile.hash !== cloudFile.hash
        ) {
          cloudFile.id = knownFile.id;
          await FileData.update(span, cloudFile);
          syncSummary.updated++;
        }
      }
      for (const knownFile of knownFiles) {
        const cloudFile = _.find(cloudFiles, { folderpath: knownFile.folderpath, filename: knownFile.filename });
        if (!cloudFile) {
          await FileData.delete(span, knownFile.id);
          syncSummary.deleted++;
        }
      }

      if (syncSummary.added > 0 || syncSummary.updated > 0 || syncSummary.deleted > 0) {
        logger.info(
          `Sync done for ${account.getAccountDefinition().id} ${folder.folderpath} in ${
            new Date().getTime() / 1000 - syncSummary.dateStarted.getTime() / 1000
          } s - ${syncSummary.added} added ; ${syncSummary.updated} updated ; ${syncSummary.deleted} deleted ; `
        );
      }
    } catch (err) {
      logger.error(err);
    }
    span.end();
    await Timeout.wait(1);
    SyncInventory.processQueue();
  }
}
