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
    const accountId = account.getAccountDefinition().id;
    logger.info(`Sync folder: ${accountId}: ${knownFolder.folderpath}`, span);

    // Downstream listings depend on the resolved cloud root.
    const cloudFolder = await account.getFolder(span, knownFolder);

    // Run independent cloud listings and DB reads in parallel.
    const [cloudSubFolders, cloudSubFiles, knownSubFilesFull, knownSubFolders] =
      await Promise.all([
        account.listFoldersInFolder(span, cloudFolder),
        account.listFilesInFolder(span, cloudFolder),
        FileDataListByFolder(span, accountId, knownFolder.id),
        FolderDataListSubFolders(span, knownFolder),
      ]);

    // Build compact ID sets for O(1) membership tests.
    const knownSubFolderIds = new Set<string>();
    for (const f of knownSubFolders) knownSubFolderIds.add(f.id);
    const cloudSubFolderIds = new Set<string>();
    for (const f of cloudSubFolders) cloudSubFolderIds.add(f.id);
    const knownSubFileIds = new Set<string>();
    for (const f of knownSubFilesFull) knownSubFileIds.add(f.id);
    const cloudSubFileIds = new Set<string>();
    for (const f of cloudSubFiles) cloudSubFileIds.add(f.id);

    // Precompute IDs of known files to delete, then release the full known
    // file objects. They hold parsed info/metadata JSON and are otherwise
    // unused from here on, so this is the biggest memory win of the sync.
    const fileIdsToDelete: string[] = [];
    for (const f of knownSubFilesFull) {
      if (!cloudSubFileIds.has(f.id)) fileIdsToDelete.push(f.id);
    }
    knownSubFilesFull.length = 0;

    let updated = false;
    let folderStructureChanged = false;

    // New folders: persist and queue each for its own sync.
    for (const cloudSubFolder of cloudSubFolders) {
      if (!knownSubFolderIds.has(cloudSubFolder.id)) {
        updated = true;
        folderStructureChanged = true;
        await FolderDataAdd(span, cloudSubFolder);
        SyncQueueQueueItem(
          accountId,
          cloudSubFolder.id,
          { folderId: cloudSubFolder.id },
          "SyncInventorySyncFolder",
          priority,
        );
      }
    }
    cloudSubFolders.length = 0;
    knownSubFolderIds.clear();

    // Deleted folders: recursive DB cleanup.
    for (const knownSubFolder of knownSubFolders) {
      if (!cloudSubFolderIds.has(knownSubFolder.id)) {
        updated = true;
        folderStructureChanged = true;
        await FolderDataDeletePathRecursive(
          span,
          accountId,
          knownSubFolder.folderpath,
        );
      }
    }
    knownSubFolders.length = 0;
    cloudSubFolderIds.clear();

    // New files.
    for (const cloudSubFile of cloudSubFiles) {
      if (!knownSubFileIds.has(cloudSubFile.id)) {
        updated = true;
        cloudSubFile.folderId = knownFolder.id;
        await FileDataAdd(span, cloudSubFile);
      }
    }
    knownSubFileIds.clear();
    cloudSubFileIds.clear();

    // Deleted files (uses precomputed ID list, not the freed File objects).
    if (fileIdsToDelete.length > 0) {
      updated = true;
      for (const id of fileIdsToDelete) {
        await FileDataDelete(span, id);
      }
      fileIdsToDelete.length = 0;
    }

    // Update folder metadata.
    knownFolder.dateSync = new Date();
    knownFolder.dateUpdated = cloudFolder.dateUpdated;
    knownFolder.info = cloudFolder.info;
    await FolderDataUpdate(span, knownFolder);

    // SyncFileCacheCheckFolder reloads files from DB; drop the cloud files
    // array first to avoid keeping two full copies in memory simultaneously.
    cloudSubFiles.length = 0;
    await SyncFileCacheCheckFolder(span, account, knownFolder);

    // If the folder structure changed, queue the parent to re-sync so it
    // discovers new/deleted subfolders in its own listing.
    if (folderStructureChanged) {
      const parentFolder = await FolderDataGetParent(span, knownFolder.id);
      if (parentFolder) {
        SyncQueueQueueItem(
          accountId,
          parentFolder.id,
          { folderId: parentFolder.id },
          "SyncInventorySyncFolder",
          priority,
        );
      }
    }

    if (updated) {
      SyncEventHistoryAdd({
        objectType: SyncEventObjectTypes.FOLDER,
        objectId: knownFolder.id,
        accountId,
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
    throw errSync;
  } finally {
    span.end();
  }
}
