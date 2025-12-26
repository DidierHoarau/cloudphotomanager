import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import {
  FileDataAdd,
  FileDataDelete,
  FileDataListByFolder,
} from "../files/FileData";
import {
  FolderDataAdd,
  FolderDataDeletePathRecursive,
  FolderDataListSubFolders,
  FolderDataUpdate,
} from "../folders/FolderData";
import { Account } from "../model/Account";
import { Folder } from "../model/Folder";
import { SyncEventActions } from "../model/SyncEventActions";
import { SyncEventObjectTypes } from "../model/SyncEventObjectTypes";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SyncEventHistoryAdd } from "./SyncEventHistory";
import { SyncFileCacheCheckFolder } from "./SyncFileCache";
import { SyncQueueQueueItem } from "./SyncQueue";

const logger = OTelLogger().createModuleLogger("SyncInventory");

export async function SyncInventoryInit(context: Span): Promise<void> {
  const span = OTelTracer().startSpan("SyncInventory_init", context);
  span.end();
}

export async function SyncInventorySyncFolder(
  account: Account,
  knownFolder: Folder
): Promise<void> {
  const span = OTelTracer().startSpan("SyncInventorySyncFolder");
  try {
    logger.info(
      `Sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`,
      span
    );

    const cloudFolder = await account.getFolder(span, knownFolder);
    const cloudSubFolders = await account.listFoldersInFolder(
      span,
      cloudFolder
    );
    const cloudSubFiles = await account.listFilesInFolder(span, cloudFolder);
    const knownSubFiles = await FileDataListByFolder(
      span,
      account.getAccountDefinition().id,
      knownFolder.id
    );
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
        await FolderDataDeletePathRecursive(
          span,
          account.getAccountDefinition().id,
          knownSubFolder.folderpath
        );
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

    await SyncFileCacheCheckFolder(span, account, knownFolder);

    if (updated) {
      SyncEventHistoryAdd({
        objectType: SyncEventObjectTypes.FOLDER,
        objectId: knownFolder.id,
        accountId: account.getAccountDefinition().id,
        date: new Date(),
        action: SyncEventActions.UPDATED,
      });
    }
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    throw new Error("SyncInventorySyncFolder Failed");
  }

  span.end();
}
