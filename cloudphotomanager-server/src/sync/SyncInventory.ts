import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import * as _ from "lodash";
import { SyncQueue } from "./SyncQueue";
import { Timeout } from "../utils-std-ts/Timeout";
import { FolderData } from "../folders/FolderData";
import { Folder } from "../model/Folder";
import { SyncFileCache } from "./SyncFileCache";
import { SyncFileMetadata } from "./SyncFileMetadata";

let config: Config;
const logger = new Logger("SyncInventory");
let inProgressSyncCount = 0;
const MAX_PARALLEL_SYNC = 2;

export class SyncInventory {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_init", context);
    config = configIn;
    span.end();
  }

  public static async queueSyncFolder(context: Span, account: Account, folder: Folder): Promise<void> {
    SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, folder.idCloud, { folder, account });
    await Timeout.wait(1);
    SyncInventory.syncFolderProcessQueue();
  }

  public static async syncFolderProcessQueue(): Promise<void> {
    if (inProgressSyncCount >= MAX_PARALLEL_SYNC) {
      return;
    }

    const queuedItem = SyncQueue.pop(SyncQueue.TYPE_SYNC_INVENTORY);
    if (!queuedItem) {
      return;
    }
    const span = StandardTracer.startSpan("SyncInventory_syncFolder");
    inProgressSyncCount++;
    try {
      const knownFolder: Folder = queuedItem.folder;
      const account: Account = queuedItem.account;
      logger.info(`Sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`);
      const cloudFolder = await account.getFolder(span, knownFolder);
      const cloudSubFolders = await account.listFoldersInFolder(span, cloudFolder);
      const cloudSubFiles = await account.listFilesInFolder(span, cloudFolder);
      const knownSubFiles = await FileData.listByFolder(span, account.getAccountDefinition().id, knownFolder.id);
      const knownSubFolders = await FolderData.listByParentFolder(span, account.getAccountDefinition().id, knownFolder);

      // New Folder
      for (const cloudSubFolder of cloudSubFolders) {
        const knownSubFolder = _.find(knownSubFolders, { idCloud: cloudFolder.idCloud });
        if (!knownSubFolder) {
          await FolderData.add(span, cloudSubFolder);
          await SyncInventory.queueSyncFolder(span, account, cloudSubFolder);
        }
      }

      // New Files
      for (const cloudSubFile of cloudSubFiles) {
        const knownSubFile = _.find(knownSubFiles, { idCloud: cloudFolder.idCloud });
        if (!knownSubFile) {
          await FileData.add(span, cloudSubFile);
        }
      }

      // Deleted Folders
      for (const knownSubFolder of knownSubFolders) {
        const cloudSubFolder = _.find(cloudSubFolders, { idCloud: knownSubFolder.idCloud });
        if (!cloudSubFolder) {
          await FolderData.deletePathRecursive(span, account.getAccountDefinition().id, knownSubFolder.folderpath);
        }
      }

      // Deleted Files
      for (const knownSubFile of knownSubFiles) {
        const cloudSubFile = _.find(cloudSubFiles, { idCloud: knownSubFile.idCloud });
        if (!cloudSubFile) {
          await FileData.delete(span, knownSubFile.id);
        }
      }

      // Update folder
      knownFolder.dateSync = new Date();
      knownFolder.dateUpdated = cloudFolder.dateUpdated;
      knownFolder.info = cloudFolder.info;
      await FolderData.update(span, knownFolder);
    } catch (err) {
      logger.error(err);
    }

    inProgressSyncCount--;
    span.end();
    await Timeout.wait(1);
    SyncInventory.syncFolderProcessQueue();
  }

  public static async startSyncFoldertath(context: Span, account: Account, folder: Folder): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_startSyncFoldertath", context);
    SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, folder.folderpath, { folder, account });
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
      const cloudFiles = await account.listFilesInFolder(span, folder);
      const knownFiles = await FileData.listByFolder(span, account.getAccountDefinition().id, folder.folderpath);
      const syncSummary = { dateStarted: new Date(), added: 0, updated: 0, deleted: 0 };
      for (const cloudFile of cloudFiles) {
        const knownFile = _.find(knownFiles, { idCloud: cloudFile.idCloud });
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
        const cloudFile = _.find(cloudFiles, { idCloud: knownFile.idCloud });
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
      await SyncFileCache.startSyncForFolder(span, account, folder);
      await SyncFileMetadata.startSyncForFolder(span, account, folder);
    } catch (err) {
      logger.error(err);
    }
    span.end();
    await Timeout.wait(1);
    SyncInventory.processQueue();
  }
}
