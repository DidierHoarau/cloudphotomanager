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
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

let config: Config;
const logger = new Logger("SyncInventory");

export class SyncInventory {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_init", context);
    config = configIn;
    span.end();
  }

  public static async syncFolder(account: Account, knownFolder: Folder): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_syncFolder");
    logger.info(`Sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`);

    const cloudFolder = await account.getFolder(span, knownFolder);
    const cloudSubFolders = await account.listFoldersInFolder(span, cloudFolder);
    const cloudSubFiles = await account.listFilesInFolder(span, cloudFolder);
    const knownSubFiles = await FileData.listByFolder(span, account.getAccountDefinition().id, knownFolder.id);
    const knownSubFolders = await FolderData.listSubFolders(span, account.getAccountDefinition().id, knownFolder);

    // New Folder
    for (const cloudSubFolder of cloudSubFolders) {
      const knownSubFolder = _.find(knownSubFolders, { id: cloudSubFolder.id });
      if (!knownSubFolder) {
        await FolderData.add(span, cloudSubFolder);
        await SyncQueue.queueItem(
          account,
          cloudSubFolder.id,
          cloudSubFolder,
          SyncInventory.syncFolder,
          SyncQueueItemPriority.MEDIUM
        );
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

    SyncFileCache.checkFolder(span, account, knownFolder);

    span.end();
  }
}
