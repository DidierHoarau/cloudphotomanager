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

let config: Config;
const logger = new Logger("SyncInventory");
let inProgressSyncCount = 0;
const MAX_PARALLEL_SYNC = 1;

export class SyncInventory {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_init", context);
    config = configIn;
    span.end();
  }

  public static async syncFolder(context: Span, account: Account, folder: Folder): Promise<void> {
    SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, folder.id, { folder, account });
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
    // Prevent duplicate
    SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, queuedItem.folder.id, {
      folder: queuedItem.folder,
      account: queuedItem.account,
    });

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
      const knownSubFolders = await FolderData.listSubFolders(span, account.getAccountDefinition().id, knownFolder);

      // New Folder
      for (const cloudSubFolder of cloudSubFolders) {
        const knownSubFolder = _.find(knownSubFolders, { id: cloudFolder.id });
        if (!knownSubFolder) {
          await FolderData.add(span, cloudSubFolder);
          await SyncInventory.syncFolder(span, account, cloudSubFolder);
        }
      }

      // New Files
      for (const cloudSubFile of cloudSubFiles) {
        const knownSubFile = _.find(knownSubFiles, { id: cloudSubFile.id });
        if (!knownSubFile) {
          cloudSubFile.folderId = knownFolder.id;
          await FileData.add(span, cloudSubFile);
        }
      }

      // Deleted Folders
      for (const knownSubFolder of knownSubFolders) {
        const cloudSubFolder = _.find(cloudSubFolders, { id: knownSubFolder.id });
        if (!cloudSubFolder) {
          console.log(knownFolder.folderpath, knownSubFolders[0]);
          await FolderData.deletePathRecursive(span, account.getAccountDefinition().id, knownSubFolder.folderpath);
        }
      }

      // Deleted Files
      for (const knownSubFile of knownSubFiles) {
        const cloudSubFile = _.find(cloudSubFiles, { id: knownSubFile.id });
        if (!cloudSubFile) {
          await FileData.delete(span, knownSubFile.id);
        }
      }

      // Update folder
      knownFolder.dateSync = new Date();
      knownFolder.dateUpdated = cloudFolder.dateUpdated;
      knownFolder.info = cloudFolder.info;
      await FolderData.update(span, knownFolder);

      SyncFileCache.syncFolder(span, account, knownFolder);
    } catch (err) {
      logger.error(err);
    }

    inProgressSyncCount--;
    SyncQueue.popId(SyncQueue.TYPE_SYNC_INVENTORY, queuedItem.folder.id);
    span.end();
    await Timeout.wait(1);
    SyncInventory.syncFolderProcessQueue();
    SyncFileCache.syncFolderProcessQueue();
  }
}
