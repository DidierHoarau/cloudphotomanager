import { Span } from "@opentelemetry/sdk-trace-base";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";
import { FolderDataAdd, FolderDataGet } from "../folders/FolderData";
import { SyncInventorySyncFolder } from "./SyncInventory";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

const logger = OTelLogger().createModuleLogger("SyncMoveConflict");

// Conflict snapshot types. Kept here (not in SyncFailures.ts) because they are
// produced by the detector; SyncFailures.ts re-exports them for callers that
// only consume them as part of a SyncFailure.
export interface SyncFailureConflictSnapshot {
  filename: string;
  folderpath: string;
  dateMedia: string | null;
  size: number | null;
}

export interface SyncFailureConflict {
  sourceFileId: string;
  targetFileId: string | null;
  targetFolderId: string | null;
  targetFolderpath: string;
  targetFilename: string;
  source: SyncFailureConflictSnapshot;
  target: SyncFailureConflictSnapshot;
}

export class MoveConflictError extends Error {
  public readonly conflict: SyncFailureConflict;
  constructor(conflict: SyncFailureConflict) {
    super(
      `Move conflict: ${conflict.targetFilename} already exists in ${conflict.targetFolderpath}`,
    );
    this.name = "MoveConflictError";
    this.conflict = conflict;
  }
}

/**
 * Public entry point. Runs three defense layers in order and returns the
 * first positive match, or null if no conflict is detected. All layer
 * failures are logged but never propagate (the caller can always fall back
 * to its own error handling).
 *
 *  - Layer A: case-insensitive scan of the local `files` table.
 *  - Layer B: ensure the target folder is indexed (pull from cloud if
 *             missing), run SyncInventorySyncFolder to refresh its file
 *             listing, then rerun Layer A.
 *  - Layer C: authoritative cloud listing via Account.listFilesInFolder.
 */
export async function DetectMoveConflict(
  context: Span,
  account: Account,
  file: File,
  targetFolderpath: string,
): Promise<MoveConflictError | null> {
  const span = OTelTracer().startSpan("DetectMoveConflict", context);
  try {
    const accountId = account.getAccountDefinition().id;
    if (!targetFolderpath) {
      return null;
    }

    // Layer A: local DB pre-check.
    const layerA = await checkLocalDb(span, accountId, file, targetFolderpath);
    if (layerA) {
      return layerA;
    }

    // Layer B: refresh target folder index, then rerun Layer A.
    let targetFolder: Folder | null = null;
    try {
      targetFolder = await refreshTargetFolderIndex(
        span,
        account,
        targetFolderpath,
      );
    } catch (refreshErr) {
      logger.warn(
        `DetectMoveConflict: refresh target folder "${targetFolderpath}" failed: ${(refreshErr as Error)?.message}`,
        span,
      );
    }
    const layerB = await checkLocalDb(span, accountId, file, targetFolderpath);
    if (layerB) {
      return layerB;
    }

    // Layer C: authoritative cloud listing fallback. Only reachable when the
    // local DB does not yet know about a same-name file in the target folder.
    try {
      const layerC = await checkCloudListing(
        span,
        account,
        file,
        targetFolder,
        targetFolderpath,
      );
      if (layerC) {
        return layerC;
      }
    } catch (cloudErr) {
      logger.warn(
        `DetectMoveConflict: cloud listing fallback for "${targetFolderpath}" failed: ${(cloudErr as Error)?.message}`,
        span,
      );
    }

    return null;
  } finally {
    span.end();
  }
}

async function checkLocalDb(
  span: Span,
  accountId: string,
  file: File,
  targetFolderpath: string,
): Promise<MoveConflictError | null> {
  const targetFolderRows = SqlDbUtilsQuerySQL(
    span,
    "SELECT id FROM folders WHERE accountId = ? AND folderpath = ? LIMIT 1",
    [accountId, targetFolderpath],
  );
  const targetFolderId: string | null =
    targetFolderRows.length > 0 ? targetFolderRows[0].id : null;
  if (!targetFolderId || targetFolderId === file.folderId) {
    return null;
  }
  const clashRows = SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM files WHERE accountId = ? AND folderId = ? AND filename = ? COLLATE NOCASE AND id != ? LIMIT 1",
    [accountId, targetFolderId, file.filename, file.id],
  );
  if (clashRows.length === 0) {
    return null;
  }
  const clashRaw = clashRows[0];
  let clashInfo: { size?: number } = {};
  try {
    clashInfo = clashRaw.info ? JSON.parse(clashRaw.info) : {};
  } catch {
    clashInfo = {};
  }
  const sourceFolder = await FolderDataGet(span, file.folderId);
  return buildConflictError(file, targetFolderpath, {
    targetFileId: clashRaw.id,
    targetFolderId,
    targetFilename: clashRaw.filename,
    sourceFolderpath: sourceFolder ? sourceFolder.folderpath : "",
    targetDateMedia: clashRaw.dateMedia ? clashRaw.dateMedia : null,
    targetSize:
      clashInfo && typeof clashInfo.size === "number" ? clashInfo.size : null,
  });
}

/**
 * Makes sure the target folder exists in the local DB (pulling it from the
 * cloud if needed) and refreshes its file listing. Returns the Folder on
 * success, null when the target folder cannot be resolved at all.
 */
async function refreshTargetFolderIndex(
  span: Span,
  account: Account,
  targetFolderpath: string,
): Promise<Folder | null> {
  let targetFolderCloud: Folder | null = null;
  try {
    targetFolderCloud = await account.getFolderByPath(span, targetFolderpath);
  } catch (err) {
    logger.warn(
      `refreshTargetFolderIndex: getFolderByPath("${targetFolderpath}") failed: ${(err as Error)?.message}`,
      span,
    );
    return null;
  }
  if (!targetFolderCloud) {
    return null;
  }
  let targetFolderDb: Folder | null = null;
  try {
    targetFolderDb = await FolderDataGet(span, targetFolderCloud.id);
  } catch (err) {
    logger.warn(
      `refreshTargetFolderIndex: FolderDataGet failed: ${(err as Error)?.message}`,
      span,
    );
  }
  if (!targetFolderDb) {
    try {
      targetFolderCloud.dateSync = new Date(0);
      await FolderDataAdd(span, targetFolderCloud);
      targetFolderDb = targetFolderCloud;
    } catch (err) {
      logger.warn(
        `refreshTargetFolderIndex: FolderDataAdd failed: ${(err as Error)?.message}`,
        span,
      );
      return null;
    }
  }
  try {
    await SyncInventorySyncFolder(
      account,
      targetFolderDb,
      SyncQueueItemPriority.INTERACTIVE,
    );
  } catch (err) {
    logger.warn(
      `refreshTargetFolderIndex: SyncInventorySyncFolder failed: ${(err as Error)?.message}`,
      span,
    );
  }
  return targetFolderDb;
}

/**
 * Authoritative cloud check. Invoked when the local DB still does not show a
 * clash after a refresh (e.g. the refresh step failed, or the cloud index
 * uses a different collation than the DB).
 */
async function checkCloudListing(
  span: Span,
  account: Account,
  file: File,
  targetFolder: Folder | null,
  targetFolderpath: string,
): Promise<MoveConflictError | null> {
  let folder = targetFolder;
  if (!folder) {
    try {
      folder = await account.getFolderByPath(span, targetFolderpath);
    } catch (err) {
      logger.warn(
        `checkCloudListing: getFolderByPath("${targetFolderpath}") failed: ${(err as Error)?.message}`,
        span,
      );
      return null;
    }
  }
  if (!folder) {
    return null;
  }
  if (folder.id === file.folderId) {
    return null;
  }
  const cloudFiles = await account.listFilesInFolder(span, folder);
  if (!cloudFiles || cloudFiles.length === 0) {
    return null;
  }
  const lowerFilename = file.filename.toLowerCase();
  const clashCloud = cloudFiles.find(
    (f) => f.filename.toLowerCase() === lowerFilename && f.id !== file.id,
  );
  if (!clashCloud) {
    return null;
  }
  const sourceFolder = await FolderDataGet(span, file.folderId);
  const clashInfo = clashCloud.info || {};
  return buildConflictError(file, targetFolderpath, {
    // The cloud-listed file may not yet be in the local DB. We still store
    // its id so the UI can render the thumbnail if the local cache catches
    // up; if not, the UI falls back to its placeholder.
    targetFileId: clashCloud.id || null,
    targetFolderId: folder.id,
    targetFilename: clashCloud.filename,
    sourceFolderpath: sourceFolder ? sourceFolder.folderpath : "",
    targetDateMedia: clashCloud.dateMedia
      ? clashCloud.dateMedia.toISOString()
      : null,
    targetSize:
      typeof (clashInfo as { size?: number }).size === "number"
        ? (clashInfo as { size?: number }).size || null
        : null,
  });
}

interface BuildConflictArgs {
  targetFileId: string | null;
  targetFolderId: string | null;
  targetFilename: string;
  sourceFolderpath: string;
  targetDateMedia: string | null;
  targetSize: number | null;
}

function buildConflictError(
  file: File,
  targetFolderpath: string,
  args: BuildConflictArgs,
): MoveConflictError {
  return new MoveConflictError({
    sourceFileId: file.id,
    targetFileId: args.targetFileId,
    targetFolderId: args.targetFolderId,
    targetFolderpath,
    targetFilename: args.targetFilename,
    source: {
      filename: file.filename,
      folderpath: args.sourceFolderpath,
      dateMedia: file.dateMedia ? file.dateMedia.toISOString() : null,
      size:
        file.info && typeof file.info.size === "number" ? file.info.size : null,
    },
    target: {
      filename: args.targetFilename,
      folderpath: targetFolderpath,
      dateMedia: args.targetDateMedia,
      size: args.targetSize,
    },
  });
}
