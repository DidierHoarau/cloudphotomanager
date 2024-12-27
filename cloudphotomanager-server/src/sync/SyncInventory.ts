import { Span } from "@opentelemetry/sdk-trace-base";
import { FileDataAdd, FileDataDelete, FileDataListByFolder } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { Logger } from "../utils-std-ts/Logger";
import * as _ from "lodash";
import {
  FolderDataAdd,
  FolderDataDeletePathRecursive,
  FolderDataListSubFolders,
  FolderDataUpdate,
} from "../folders/FolderData";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueQueueItem } from "./SyncQueue";
import { SyncFileCacheCheckFolder } from "./SyncFileCache";
import { SyncEventHistoryAdd } from "./SyncEventHistory";
import { SyncEventObjectTypes } from "../model/SyncEventObjectTypes";
import { SyncEventActions } from "../model/SyncEventActions";

const logger = new Logger("SyncInventory");

export async function SyncInventoryInit(context: Span): Promise<void> {
  const span = StandardTracerStartSpan("SyncInventory_init", context);
  span.end();
}

export async function SyncInventorySyncFolder(account: Account, knownFolder: Folder): Promise<void> {
  const span = StandardTracerStartSpan("SyncInventorySyncFolder");
  logger.info(`Sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`);

  const cloudFolder = await account.getFolder(span, knownFolder);
  const cloudSubFolders = await account.listFoldersInFolder(span, cloudFolder);
  const cloudSubFiles = await account.listFilesInFolder(span, cloudFolder);
  const knownSubFiles = await FileDataListByFolder(span, account.getAccountDefinition().id, knownFolder.id);
  const knownSubFolders = await FolderDataListSubFolders(span, knownFolder);

  let updated = false;

  // New Folder
  for (const cloudSubFolder of cloudSubFolders) {
    const knownSubFolder = _.find(knownSubFolders, { id: cloudSubFolder.id });
    if (!knownSubFolder) {
      updated = true;
      await FolderDataAdd(span, cloudSubFolder);
      await SyncQueueQueueItem(
        account,
        cloudSubFolder.id,
        cloudSubFolder,
        SyncInventorySyncFolder,
        SyncQueueItemPriority.NORMAL
      );
    }
  }

  // New Files
  for (const cloudSubFile of cloudSubFiles) {
    const knownSubFile = _.find(knownSubFiles, { id: cloudSubFile.id });
    if (!knownSubFile) {
      updated = true;
      cloudSubFile.folderId = knownFolder.id;
      await FileDataAdd(span, cloudSubFile);
    }
  }

  // Deleted Folders
  for (const knownSubFolder of knownSubFolders) {
    const cloudSubFolder = _.find(cloudSubFolders, { id: knownSubFolder.id });
    if (!cloudSubFolder) {
      updated = true;
      await FolderDataDeletePathRecursive(span, account.getAccountDefinition().id, knownSubFolder.folderpath);
    }
  }

  // Deleted Files
  for (const knownSubFile of knownSubFiles) {
    const cloudSubFile = _.find(cloudSubFiles, { id: knownSubFile.id });
    if (!cloudSubFile) {
      updated = true;
      await FileDataDelete(span, knownSubFile.id);
    }
  }

  // Update folder
  knownFolder.dateSync = new Date();
  knownFolder.dateUpdated = cloudFolder.dateUpdated;
  knownFolder.info = cloudFolder.info;
  await FolderDataUpdate(span, knownFolder);

  SyncFileCacheCheckFolder(span, account, knownFolder);

  if (updated) {
    SyncEventHistoryAdd({
      objectType: SyncEventObjectTypes.FOLDER,
      objectId: knownFolder.id,
      date: new Date(),
      action: SyncEventActions.UPDATED,
    });
  }

  span.end();
}
