import { Span } from "@opentelemetry/sdk-trace-base";
import {
  FileDataAdd,
  FileDataDelete,
  FileDataListByFolder,
} from "../files/FileData";
import {
  FolderDataAdd,
  FolderDataDeletePathRecursive,
  FolderDataGetParent,
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

export async function SyncInventorySyncFolder(
  account: Account,
  knownFolder: Folder,
  priority: SyncQueueItemPriority = SyncQueueItemPriority.NORMAL,
): Promise<void> {
  const span = OTelTracer().startSpan("SyncInventorySyncFolder");
  try {
    logger.info(
      `Sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`,
      span,
    );

    const cloudFolder = await account.getFolder(span, knownFolder);
    const cloudSubFolders = await account.listFoldersInFolder(
      span,
      cloudFolder,
    );
    const cloudSubFiles = await account.listFilesInFolder(span, cloudFolder);
    const knownSubFiles = await FileDataListByFolder(
      span,
      account.getAccountDefinition().id,
      knownFolder.id,
    );
    const knownSubFolders = await FolderDataListSubFolders(span, knownFolder);
    let updated = false;

    // Build lookup maps for O(1) access
    const knownSubFolderIds = new Set(knownSubFolders.map((f) => f.id));
    const knownSubFileIds = new Set(knownSubFiles.map((f) => f.id));
    const cloudSubFolderIds = new Set(cloudSubFolders.map((f) => f.id));
    const cloudSubFileIds = new Set(cloudSubFiles.map((f) => f.id));

    let folderStructureChanged = false;

    // New Folder
    for (const cloudSubFolder of cloudSubFolders) {
      if (!knownSubFolderIds.has(cloudSubFolder.id)) {
        updated = true;
        folderStructureChanged = true;
        await FolderDataAdd(span, cloudSubFolder);
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          cloudSubFolder.id,
          cloudSubFolder,
          "SyncInventorySyncFolder",
          priority,
        );
      }
    }

    // New Files
    const newFiles = cloudSubFiles.filter((f) => !knownSubFileIds.has(f.id));
    if (newFiles.length > 0) {
      updated = true;
      for (const cloudSubFile of newFiles) {
        cloudSubFile.folderId = knownFolder.id;
        await FileDataAdd(span, cloudSubFile);
      }
    }

    // Deleted Folders
    for (const knownSubFolder of knownSubFolders) {
      if (!cloudSubFolderIds.has(knownSubFolder.id)) {
        updated = true;
        folderStructureChanged = true;
        await FolderDataDeletePathRecursive(
          span,
          account.getAccountDefinition().id,
          knownSubFolder.folderpath,
        );
      }
    }

    // Deleted Files
    const deletedFiles = knownSubFiles.filter(
      (f) => !cloudSubFileIds.has(f.id),
    );
    if (deletedFiles.length > 0) {
      updated = true;
      for (const knownSubFile of deletedFiles) {
        await FileDataDelete(span, knownSubFile.id);
      }
    }

    // Update folder
    knownFolder.dateSync = new Date();
    knownFolder.dateUpdated = cloudFolder.dateUpdated;
    knownFolder.info = cloudFolder.info;
    await FolderDataUpdate(span, knownFolder);

    await SyncFileCacheCheckFolder(span, account, knownFolder);

    // If the folder structure changed, queue the parent to re-sync so it
    // discovers new/deleted subfolders in its own listing
    if (folderStructureChanged) {
      const parentFolder = await FolderDataGetParent(span, knownFolder.id);
      if (parentFolder) {
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          parentFolder.id,
          parentFolder,
          "SyncInventorySyncFolder",
          priority,
        );
      }
    }

    if (updated) {
      SyncEventHistoryAdd({
        objectType: SyncEventObjectTypes.FOLDER,
        objectId: knownFolder.id,
        accountId: account.getAccountDefinition().id,
        date: new Date(),
        action: SyncEventActions.UPDATED,
      });
    }
  } catch (errSync: unknown) {
    const message =
      errSync instanceof Error ? errSync.message : String(errSync);
    span.setStatus({ code: 2, message });
    if (errSync instanceof Error) {
      span.recordException(errSync);
    }
    span.end();
    throw errSync;
  }

  span.end();
}

export async function SyncInventorySyncFolderRecursive(
  account: Account,
  knownFolder: Folder,
  priority: SyncQueueItemPriority = SyncQueueItemPriority.NORMAL,
): Promise<void> {
  const span = OTelTracer().startSpan("SyncInventorySyncFolderRecursive");
  try {
    logger.info(
      `Deep sync folder: ${account.getAccountDefinition().id}: ${knownFolder.folderpath}`,
      span,
    );

    // Sync the current folder first
    await SyncInventorySyncFolder(account, knownFolder, priority);

    // Get all subfolders and recursively sync them
    const allSubFolders = await FolderDataListSubFolders(span, knownFolder);
    for (const subFolder of allSubFolders) {
      await SyncInventorySyncFolderRecursive(account, subFolder, priority);
    }
  } catch (errSync: unknown) {
    const message =
      errSync instanceof Error ? errSync.message : String(errSync);
    span.setStatus({ code: 2, message });
    if (errSync instanceof Error) {
      span.recordException(errSync);
    }
    span.end();
    throw errSync;
  }

  span.end();
}
