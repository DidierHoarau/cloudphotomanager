import {
  FileDataAdd,
  FileDataDelete,
  FileDataListByFolder,
  FileDataRecordSyncSuccess,
  FileDataUpdate,
  FileDataUpdateKeywords,
} from "../files/FileData";
import {
  FolderDataAdd,
  FolderDataDeletePathRecursive,
  FolderDataGetParent,
  FolderDataListSubFolders,
  FolderDataUpdate,
} from "../folders/FolderData";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { SyncEventActions } from "../model/SyncEventActions";
import { SyncEventObjectTypes } from "../model/SyncEventObjectTypes";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SyncEventHistoryAdd } from "./SyncEventHistory";
import {
  SyncFileCacheCheckFolder,
  SyncFileCacheRemoveFile,
} from "./SyncFileCache";
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
    // Cloud files keyed by id, for reconciliation and stale-reference repair.
    const cloudSubFilesById = new Map<string, File>();
    for (const f of cloudSubFiles) cloudSubFilesById.set(f.id, f);

    let updated = false;
    let folderStructureChanged = false;

    // Reconcile known vs cloud files: record deletions for files gone from
    // the cloud, and repair stale provider item references on files that
    // still match by id. Full known file objects are released afterwards
    // (they hold parsed info/metadata JSON, so keep this loop tight).
    const fileIdsToDelete: string[] = [];
    for (const knownFile of knownSubFilesFull) {
      const cloudFile = cloudSubFilesById.get(knownFile.id);
      if (!cloudFile) {
        fileIdsToDelete.push(knownFile.id);
        continue;
      }
      if (
        cloudFile.idCloud === knownFile.idCloud &&
        cloudFile.hash === knownFile.hash
      ) {
        continue;
      }
      // The cloud item kept the same id (path/name) but its provider item
      // reference and/or content changed. Without this refresh, every
      // download keeps failing with "item not found" until the record is
      // repaired here.
      const contentChanged = Boolean(
        knownFile.hash && cloudFile.hash && knownFile.hash !== cloudFile.hash,
      );
      knownFile.idCloud = cloudFile.idCloud;
      knownFile.hash = cloudFile.hash;
      knownFile.dateUpdated = cloudFile.dateUpdated;
      knownFile.dateSync = new Date();
      await FileDataUpdate(span, knownFile);
      updated = true;
      if (contentChanged) {
        // Content was replaced under the same name: cached previews and
        // extracted keywords are stale and must be regenerated from the
        // new content. Reset the failure counter so regeneration is not
        // blocked by the retry cap; the cache check at the end of the sync
        // re-queues the missing previews/thumbnails.
        await SyncFileCacheRemoveFile(span, account, knownFile);
        knownFile.keywords = null;
        await FileDataUpdateKeywords(span, knownFile);
        await FileDataRecordSyncSuccess(span, knownFile.id);
      }
    }
    knownSubFilesFull.length = 0;

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
