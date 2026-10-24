import { Span } from "@opentelemetry/sdk-trace-base";
import * as exifr from "exifr";
import * as fs from "fs-extra";
import * as path from "path";
import sharp from "sharp";
import { AnalysisImagesGetLabels } from "../analysis/AnalysisImages";
import { Config } from "../Config";
import {
  FileDataGet,
  FileDataGetFileCacheDir,
  FileDataGetFileTmpDir,
  FileDataListByFolder,
  FileDataListForAccountPaginated,
  FileDataListIdsForAccount,
  FileDataUpdateInfo,
  FileDataUpdateKeywords,
} from "../files/FileData";
import { extractGps } from "../files/ExifGpsExtractor";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { FileMediaType } from "../model/FileMediaType";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SystemCommand } from "../SystemCommand";
import { ThumbnailNotAvailableError } from "../accounts/oneDrive/OneDriveFileOperations";
import { SyncQueueQueueItem } from "./SyncQueue";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncQueueGetBatchWaitingCount } from "./SyncQueue";

const logger = OTelLogger().createModuleLogger("SyncFileCache");
let config: Config;

// Number of consecutive sync failures after which a file is no longer
// auto re-queued by SyncFileCacheCheckFile / the nightly check. The counter
// is reset by a successful sync or a manual retry from the Sync Failures UI.
// Lives in SyncRetryCap.ts (dependency-free) so the queue can compare against
// it without touching this module's exports mid-cycle.
import { SYNC_FAIL_MAX_AUTO_RETRY } from "./SyncRetryCap";

// The sync cache owns ${TMP_DIR}/cache only: TMP_DIR itself (default /tmp) is
// shared with the rest of the system and must never be wiped. Returns null
// for a misconfigured TMP_DIR (empty, relative or a filesystem root) so the
// caller can refuse the cleanup instead of deleting unrelated data.
export function SyncFileCacheResolveTempCacheDir(tmpDir: string): string | null {
  if (typeof tmpDir !== "string" || tmpDir.trim().length === 0) {
    return null;
  }
  if (!path.isAbsolute(tmpDir)) {
    return null;
  }
  const resolvedTmpDir = path.resolve(tmpDir);
  if (resolvedTmpDir === path.parse(resolvedTmpDir).root) {
    return null;
  }
  const cacheDir = path.join(resolvedTmpDir, "cache");
  if (cacheDir === resolvedTmpDir) {
    return null;
  }
  return cacheDir;
}

export async function SyncFileCacheInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("SyncFileCacheInit", context);
  config = configIn;

  // Function registration moved to SyncQueueInit

  const cacheDir = SyncFileCacheResolveTempCacheDir(config.TMP_DIR);
  if (!cacheDir) {
    logger.error(
      `Refusing to clean TMP_DIR "${config.TMP_DIR}": expected an absolute, non-root directory`,
      undefined,
      span,
    );
  } else {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
  span.end();
}

export async function SyncFileCacheCheckFolder(
  context: Span,
  account: Account,
  folder: Folder,
) {
  const span = OTelTracer().startSpan("SyncFileCacheCheckFolder", context);
  const files = await FileDataListByFolder(
    span,
    account.getAccountDefinition().id,
    folder.id,
  );
  for (const file of files) {
    SyncFileCacheCheckFile(span, account, file);
  }
  span.end();
}

export async function SyncFileCacheRemoveFile(
  context: Span,
  account: Account,
  file: File,
) {
  const span = OTelTracer().startSpan("SyncFileCacheRemoveFile", context);
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id,
  );
  await fs.rm(cacheDir, { recursive: true, force: true });
  span.end();
}

// Cache dirs are derived data and keyed by file id: move them after a file
// rename/move so generated previews are not regenerated. Failures are logged
// and swallowed.
export async function SyncFileCacheMoveFileCacheDir(
  context: Span,
  accountId: string,
  oldFileId: string,
  newFileId: string,
): Promise<void> {
  if (oldFileId === newFileId) {
    return;
  }
  const span = OTelTracer().startSpan("SyncFileCacheMoveFileCacheDir", context);
  try {
    const from = await FileDataGetFileCacheDir(span, accountId, oldFileId);
    const to = await FileDataGetFileCacheDir(span, accountId, newFileId);
    if (!fs.existsSync(from)) {
      return;
    }
    await fs.ensureDir(path.dirname(to));
    await fs.move(from, to, { overwrite: true });
  } catch (err) {
    logger.warn(
      `Failed to move file cache dir ${oldFileId} -> ${newFileId}: ${err?.message ?? err}`,
      span,
    );
  } finally {
    span.end();
  }
}

export async function SyncFileCacheCheckAsync(
  accountId: string,
  fileId: string,
  priority: SyncQueueItemPriority = SyncQueueItemPriority.NORMAL,
) {
  const span = OTelTracer().startSpan("SyncFileCacheCheckFileFromId");
  await SyncFileCacheCheckFile(
    span,
    await AccountFactoryGetAccountImplementation(accountId),
    await FileDataGet(span, fileId),
    priority,
  );
  span.end();
}

export async function SyncFileCacheCheckFile(
  context: Span,
  account: Account,
  file: File,
  priority: SyncQueueItemPriority = SyncQueueItemPriority.NORMAL,
) {
  const span = OTelTracer().startSpan("SyncFileCacheCheckFile", context);
  if (file.syncGone) {
    // Tombstoned as missing in the cloud: do not re-queue any work. The
    // folder re-sync is the authority that repairs or deletes the row.
    span.end();
    return;
  }
  if ((file.syncFailCount ?? 0) >= SYNC_FAIL_MAX_AUTO_RETRY) {
    logger.warn(
      `Skipping auto re-queue of file ${file.id} (${file.filename}): ` +
        `${file.syncFailCount} consecutive sync failures reached the retry cap` +
        `(${SYNC_FAIL_MAX_AUTO_RETRY}). Use the Sync Failures UI to retry manually.`,
      span,
    );
    span.end();
    return;
  }
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id,
  );
  if (fs.existsSync(`${cacheDir}/corrupt.marker`)) {
    // The image content was detected as corrupt: no recurring re-queues (the
    // warn was logged once when the marker was written). A manual rebuild of
    // the cache removes the marker and restores retries.
    span.end();
    return;
  }
  const isImage =
    File.getMediaType(file.filename) === FileMediaType.image ||
    File.getMediaType(file.filename) === FileMediaType.imageRaw;
  const isVideo = File.getMediaType(file.filename) === FileMediaType.video;
  const hasThumbnail = fs.existsSync(`${cacheDir}/thumbnail.webp`);
  const hasImagePreview = fs.existsSync(`${cacheDir}/preview.webp`);
  const hasVideoPreview = fs.existsSync(`${cacheDir}/preview.mp4`);
  const accountCapabilities = account.getCapabilities();

  if (
    (isImage && !hasThumbnail && accountCapabilities.downloadPhotoThumbnail) ||
    (isVideo && !hasThumbnail && accountCapabilities.downloadVideoThumbnail)
  ) {
    await SyncQueueQueueItem(
      account.getAccountDefinition().id,
      file.id,
      { fileId: file.id },
      "syncThumbnail",
      priority,
      [file.id],
    );
  }

  if (isImage && !hasImagePreview) {
    await SyncQueueQueueItem(
      account.getAccountDefinition().id,
      file.id,
      { fileId: file.id },
      "syncPhotoFromFull",
      priority,
      [file.id],
    );
  }

  if (isImage && !file.keywords) {
    await SyncQueueQueueItem(
      account.getAccountDefinition().id,
      file.id,
      { fileId: file.id },
      "syncPhotoKeyWords",
      SyncQueueItemPriority.BATCH,
      [file.id],
    );
  }

  if (isVideo && !hasVideoPreview) {
    await SyncQueueQueueItem(
      account.getAccountDefinition().id,
      file.id,
      { fileId: file.id },
      "syncVideoFromFull",
      SyncQueueItemPriority.BATCH,
      [file.id],
    );
  }

  if (isVideo && hasVideoPreview && !hasThumbnail) {
    await SyncQueueQueueItem(
      account.getAccountDefinition().id,
      file.id,
      { fileId: file.id },
      "syncThumbnailFromVideoPreview",
      priority,
      [file.id],
    );
  }

  span.end();
}

export async function SyncFileCacheCleanUp(context: Span, account: Account) {
  const span = OTelTracer().startSpan("SyncFileCacheCleanUp", context);
  try {
    const accountId = account.getAccountDefinition().id;
    // Ids only: no File objects, no per-file lookups. The cache tree is
    // shard/subshard/fileId, so two directory levels then the id dirs.
    const knownFileIds = new Set(
      await FileDataListIdsForAccount(span, accountId),
    );
    const accountCacheRoot = `${config.DATA_DIR}/cache/${accountId}`;
    if (!fs.existsSync(accountCacheRoot)) {
      return;
    }
    const shards = await fs.readdir(accountCacheRoot, { withFileTypes: true });
    for (const shard of shards) {
      if (!shard.isDirectory()) {
        continue;
      }
      const shardPath = path.join(accountCacheRoot, shard.name);
      const subShards = await fs.readdir(shardPath, { withFileTypes: true });
      for (const subShard of subShards) {
        if (!subShard.isDirectory()) {
          continue;
        }
        const subShardPath = path.join(shardPath, subShard.name);
        const cacheDirs = await fs.readdir(subShardPath, {
          withFileTypes: true,
        });
        for (const cacheDir of cacheDirs) {
          if (!cacheDir.isDirectory() || knownFileIds.has(cacheDir.name)) {
            continue;
          }
          logger.info(`Cleaning Cache: ${accountId} ${cacheDir.name}`, span);
          await fs.remove(path.join(subShardPath, cacheDir.name));
        }
      }
    }
  } finally {
    span.end();
  }
}

// Private Functions

// sharp/libvips error signatures for unreadable image content (truncated or
// corrupt JPEG streams). Used to skip cache generation instead of failing.
function isCorruptImageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /VipsJpeg|Corrupt JPEG data|premature end/i.test(message);
}

// HEIC/HEIF content behind a non-HEIC extension (e.g. Samsung MVIMG_*.jpg)
// must not reach sharp's bundled libheif (SIGSEGV risk); such files are
// converted through ImageMagick (system libheif) instead.
function isHeicContentFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const brand = buf.toString("ascii", 4, 12);
    return (
      brand.startsWith("ftyp") &&
      ["heic", "heix", "mif1", "msf1"].includes(buf.toString("ascii", 8, 12))
    );
  } catch {
    // If we can't read the file, proceed and let sharp handle it
    return false;
  }
}

// The cloud thumbnail service can permanently answer 406/416 for some items
// (videos without a poster frame, broken CDN entries). Videos skip cleanly:
// syncThumbnailFromVideoPreview derives their thumbnail once preview.mp4 is
// cached. Images fall back to a full-file download and local generation.
async function generateThumbnailWhenCloudThumbnailUnavailable(
  span: Span,
  account: Account,
  file: File,
  cacheDir: string,
  tmpDir: string,
  tmpFileName: string,
  signal?: AbortSignal,
): Promise<void> {
  if (File.getMediaType(file.filename) === FileMediaType.video) {
    logger.info(
      `Thumbnail unavailable from cloud for video ${account.getAccountDefinition().id} ${file.id} : ${file.filename}; will be derived from the video preview once cached`,
      span,
    );
    return;
  }
  logger.info(
    `Thumbnail unavailable from cloud for ${account.getAccountDefinition().id} ${file.id} : ${file.filename}; generating from the full file`,
    span,
  );
  await account.downloadFile(span, file, tmpDir, tmpFileName);
  const fullPath = `${tmpDir}/${tmpFileName}`;
  let sourcePath = fullPath;
  if (isHeicContentFile(fullPath)) {
    await SystemCommand.executeFile(
      `${config.TOOLS_DIR}/tools-image-convert-raw.sh`,
      [fullPath, `${fullPath}_raw.jpg`],
      { signal },
    );
    sourcePath = `${fullPath}_raw.jpg`;
  }
  await sharp(sourcePath)
    .rotate()
    .withMetadata()
    .resize({ width: 300 })
    .toFile(`${cacheDir}/thumbnail.webp`);
}

async function getVideoWidthWithFfprobe(
  context: Span,
  filePath: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const span = OTelTracer().startSpan("getVideoWidthWithFfprobe", context);
  try {
    const ffprobeOutput = await SystemCommand.executeFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { signal },
    );
    const width = parseInt(ffprobeOutput.trim(), 10);
    span.end();
    if (!isNaN(width)) {
      return width;
    }
    return null;
  } catch (err) {
    logger.error("Error getting Video Width", err, span);
    span.end();
    return null;
  }
}

export async function syncVideoFromFull(
  account: Account,
  file: File,
  signal?: AbortSignal,
) {
  const span = OTelTracer().startSpan("syncVideoFromFull");
  let tmpDir: string = null;
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    await fs.ensureDir(cacheDir);
    await fs.remove(tmpDir);
    await fs.ensureDir(tmpDir);
    const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching video ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span,
    );
    await account
      .downloadFile(span, file, tmpDir, tmpFileName)
      .then(async () => {
        let targetWidth = config.VIDEO_PREVIEW_WIDTH;
        const width = await getVideoWidthWithFfprobe(
          span,
          `${tmpDir}/${tmpFileName}`,
          signal,
        );
        if (width !== null) {
          if (width > config.VIDEO_PREVIEW_WIDTH) {
            targetWidth = config.VIDEO_PREVIEW_WIDTH;
          } else {
            targetWidth = width;
          }
        }
        logger.info(
          await SystemCommand.executeFile(
            `${config.TOOLS_DIR}/tools-video-process.sh`,
            [
              `${tmpDir}/${tmpFileName}`,
              `${tmpDir}/${tmpFileName}.mp4`,
              `${targetWidth}`,
            ],
            { signal },
          ),
          span,
        );
        if ((await fs.stat(`${tmpDir}/${tmpFileName}.mp4`)).size === 0) {
          throw new Error("Generated file empty");
        }
        await fs.move(
          `${tmpDir}/${tmpFileName}.mp4`,
          `${cacheDir}/preview.mp4`,
        );
      })
      .catch((err) => {
        logger.warn(`Error Synchronizing Video: ${err?.message ?? err}`, span);
        throw err;
      });
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    const err = new Error("syncVideoFromFull Failed");
    err.cause = errSync;
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  }
}

export async function syncPhotoFromFull(
  account: Account,
  file: File,
  signal?: AbortSignal,
) {
  const span = OTelTracer().startSpan("syncPhotoFromFull");
  let tmpDir: string = null;
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(tmpDir);
    let tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span,
    );
    await account
      .downloadFile(span, file, tmpDir, tmpFileName)
      .then(async () => {
        if (File.getMediaType(file.filename) === FileMediaType.imageRaw) {
          logger.info(
            await SystemCommand.executeFile(
              `${config.TOOLS_DIR}/tools-image-convert-raw.sh`,
              [`${tmpDir}/${tmpFileName}`, `${tmpDir}/${tmpFileName}_raw.jpg`],
              { signal },
            ),
            span,
          );
          tmpFileName += "_raw.jpg";
        }
        // Extract full EXIF and GPS (including Xiaomi maker-note fallback) from
        // the raw source file using exifr — handles all IFDs, maker notes, and
        // GPS IFD natively. Falls back to Xiaomi city-tag geocoding when the
        // standard GPS IFD is absent.
        try {
          const filePath = `${tmpDir}/${tmpFileName}`;
          const exifData = await exifr.parse(filePath, {
            gps: true,
            tiff: true,
            exif: true,
          });
          if (exifData) {
            file.info.exif = exifData as Record<string, any>;
            const gpsResult = await extractGps(filePath);
            if (gpsResult.gpsInfo) {
              (file.info.exif as Record<string, any>).GPSInfo =
                gpsResult.gpsInfo;
            }
          }
        } catch {
          logger.info(
            `No exif metadata for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
          );
        }
        await FileDataUpdateInfo(span, file);
        // Auto-rotate pixels based on EXIF orientation tag, then strip it.
        // A corrupt image (e.g. truncated JPEG) must not fail the sync on
        // every cycle: tombstone cache generation for the file instead.
        try {
          await sharp(`${tmpDir}/${tmpFileName}`)
            .rotate()
            .withMetadata()
            .resize({ width: 300 })
            .toFile(`${cacheDir}/thumbnail.webp`);
          await sharp(`${tmpDir}/${tmpFileName}`)
            .rotate()
            .withMetadata()
            .resize({ width: 2000, height: 2000, fit: "inside" })
            .toFile(`${cacheDir}/preview.webp`);
        } catch (err) {
          if (!isCorruptImageError(err)) {
            throw err;
          }
          await fs.writeFile(
            path.join(cacheDir, "corrupt.marker"),
            err instanceof Error ? err.message : String(err),
          );
          logger.warn(
            `Corrupt image, skipping thumbnail/preview generation for ${account.getAccountDefinition().id} ${file.id} : ${file.filename}: ${err?.message ?? err}`,
            span,
          );
        }
      })
      .catch((err) => {
        logger.warn(`Error Synchronizing Photo: ${err?.message ?? err}`, span);
        throw err;
      });
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    const err = new Error("syncPhotoFromFull Failed");
    err.cause = errSync;
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  }
}

export async function syncPhotoKeyWords(
  account: Account,
  file: File,
  signal?: AbortSignal,
) {
  const span = OTelTracer().startSpan("syncPhotoKeyWords");
  let tmpDir: string = null;
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    tmpDir =
      (await FileDataGetFileTmpDir(
        span,
        account.getAccountDefinition().id,
        file.id,
      )) + "_image_classification";
    const hasImagePreview = fs.existsSync(`${cacheDir}/preview.webp`);
    file.keywords = file.filename;

    if (config.IMAGE_CLASSIFICATION_ENABLED) {
      if (!hasImagePreview) {
        await syncPhotoFromFull(account, file, signal);
      }
      await fs.ensureDir(tmpDir);
      const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
      logger.info(
        `Generating Keywords for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      );
      await sharp(`${cacheDir}/preview.webp`)
        .withMetadata()
        .toFile(`${tmpDir}/${tmpFileName}.jpeg`)
        .then(async () => {
          // Only re-extract EXIF from preview if not already populated by
          // syncPhotoFromFull (which has access to the original file and
          // therefore better GPS / maker-note data).
          const existingGps = (file.info.exif as Record<string, any> | undefined)
            ?.GPSInfo;
          if (!existingGps) {
            try {
              const previewPath = `${cacheDir}/preview.webp`;
              const previewExif = await exifr.parse(previewPath, {
                gps: true,
                tiff: true,
                exif: true,
              });
              if (previewExif) {
                file.info.exif = previewExif as Record<string, any>;
                const gpsResult = await extractGps(previewPath);
                if (gpsResult.gpsInfo) {
                  (file.info.exif as Record<string, any>).GPSInfo =
                    gpsResult.gpsInfo;
                }
              }
            } catch {
              logger.info(
                `No exif metadata for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
              );
            }
          }
          const classificationResults = await AnalysisImagesGetLabels(
            span,
            `${tmpDir}/${tmpFileName}.jpeg`,
          );
          classificationResults.forEach((result) => {
            if (result.score > 0.5) {
              file.keywords += " " + result.label;
            }
          });
          file.keywords = file.keywords.toLowerCase();
        })
        .catch((err) => {
          logger.warn(
            `Error Generating Keywords for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}: ${err?.message ?? err}`,
          );
          throw err;
        });
    }
    await FileDataUpdateKeywords(span, file);
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    const err = new Error("syncPhotoKeyWords Failed");
    err.cause = errSync;
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  }
}

export async function syncThumbnail(
  account: Account,
  file: File,
  signal?: AbortSignal,
) {
  const span = OTelTracer().startSpan("syncThumbnail");
  let tmpDir: string = null;
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(`${tmpDir}/tmp_tumbnail`);
    const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span,
    );
    // HEIC and other raw image formats can trigger a fatal SIGSEGV in sharp's
    // bundled libheif (GObject class-init bug). Download the full file and
    // convert via ImageMagick (which uses the system libheif) before creating
    // the thumbnail with sharp.
    const fileExtension = file.filename.split(".").pop()?.toLowerCase() ?? "";
    const rawExtensions = [
      "heic",
      "heif",
      "dng",
      "cr2",
      "nef",
      "arw",
      "raf",
      "rw2",
      "orf",
      "pef",
      "srw",
    ];
    if (rawExtensions.includes(fileExtension)) {
      await account
        .downloadFile(span, file, tmpDir, tmpFileName)
        .then(async () => {
          await SystemCommand.executeFile(
            `${config.TOOLS_DIR}/tools-image-convert-raw.sh`,
            [`${tmpDir}/${tmpFileName}`, `${tmpDir}/${tmpFileName}_raw.jpg`],
            { signal },
          );
          await sharp(`${tmpDir}/${tmpFileName}_raw.jpg`)
            .rotate()
            .withMetadata()
            .resize({ width: 300 })
            .toFile(`${cacheDir}/thumbnail.webp`);
        })
        .catch((err) => {
          logger.warn(
            `Error Synchronizing Thumbnail for raw file: ${err?.message ?? err}`,
            span,
          );
          throw err;
        });
    } else {
      // Also handle files that have HEIC/HEIF content despite a non-HEIC
      // extension (e.g. Samsung MVIMG_*.jpg which contains a HEIC stream).
      // Quick magic-byte check avoids triggering sharp's libheif GObject
      // SIGSEGV (see above).
      const isHeicContent = isHeicContentFile(
        `${tmpDir}/tmp_tumbnail/${tmpFileName}`,
      );
      if (isHeicContent) {
        await account
          .downloadFile(span, file, tmpDir, tmpFileName)
          .then(async () => {
            await SystemCommand.executeFile(
              `${config.TOOLS_DIR}/tools-image-convert-raw.sh`,
              [`${tmpDir}/${tmpFileName}`, `${tmpDir}/${tmpFileName}_raw.jpg`],
              { signal },
            );
            await sharp(`${tmpDir}/${tmpFileName}_raw.jpg`)
              .rotate()
              .withMetadata()
              .resize({ width: 300 })
              .toFile(`${cacheDir}/thumbnail.webp`);
          })
          .catch((err) => {
            logger.warn(
              `Error Synchronizing Thumbnail for HEIC content file: ${err?.message ?? err}`,
              span,
            );
            throw err;
          });
      } else {
        await account
          .downloadThumbnail(span, file, `${tmpDir}/tmp_tumbnail`, tmpFileName)
          .then(async () => {
            await sharp(`${tmpDir}/tmp_tumbnail/${tmpFileName}`)
              .rotate()
              .withMetadata()
              .resize({ width: 300 })
              .toFile(`${cacheDir}/thumbnail.webp`);
          })
          .catch(async (err) => {
            if (err instanceof ThumbnailNotAvailableError) {
              await generateThumbnailWhenCloudThumbnailUnavailable(
                span,
                account,
                file,
                cacheDir,
                tmpDir,
                tmpFileName,
                signal,
              );
              return;
            }
            logger.warn(`Error Synchronizing Thumbnail: ${err?.message ?? err}`, span);
            throw err;
          });
      }
    }
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    const err = new Error("syncThumbnail Failed");
    err.cause = errSync;
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  }
}

export async function syncThumbnailFromVideoPreview(
  account: Account,
  file: File,
  signal?: AbortSignal,
) {
  const span = OTelTracer().startSpan("syncThumbnailFromVideoPreview");
  let tmpDir: string = null;
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    await fs.ensureDir(cacheDir);
    await fs.remove(tmpDir);
    await fs.ensureDir(tmpDir);
    logger.info(
      `Generating video thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span,
    );
    await SystemCommand.executeFile(
      `${config.TOOLS_DIR}/tools-video-generate-thumbnail.sh`,
      [`${cacheDir}/preview.mp4`, `${tmpDir}/thumbnail.jpg`],
      { signal },
    )
      .then(async (output: string) => {
        logger.info(output, span);
        await sharp(`${tmpDir}/thumbnail.jpg`)
          .withMetadata()
          .resize({ width: 300 })
          .toFile(`${cacheDir}/thumbnail.webp`);
      })
      .catch((err) => {
        logger.warn(`Error Generating Video Thumbnail: ${err?.message ?? err}`, span);
        throw err;
      });
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    const err = new Error("syncThumbnailFromVideoPreview Failed");
    err.cause = errSync;
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  }
}

// Private Fucntions

// Daily-check batch throttle: the batch queues are drained by the workers, but
// a saturated queue must never block the daily scan forever.
const BATCH_MAX_QUEUE_SIZE = 20;
const BATCH_WAIT_POLL_MS = 5_000;
const BATCH_MAX_WAIT_MS = 30 * 60_000;

export async function SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
  context: Span,
  accountId: string,
) {
  const span = OTelTracer().startSpan(
    "SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews",
    context,
  );
  try {
    logger.info(
      `Starting daily check for files missing thumbnails or previews for account ${accountId}`,
      span,
    );

    const pageSize = 20;
    let page = 0;
    let totalQueued = 0;
    const account = await AccountFactoryGetAccountImplementation(accountId);

    while (true) {
      // Wait until the batch queue has drained below the threshold before
      // adding more, but give up after BATCH_MAX_WAIT_MS: the next daily run
      // picks up the remaining files.
      const waitedSince = Date.now();
      while (SyncQueueGetBatchWaitingCount() >= BATCH_MAX_QUEUE_SIZE) {
        if (Date.now() - waitedSince >= BATCH_MAX_WAIT_MS) {
          logger.warn(
            `Batch queue still saturated after ${BATCH_MAX_WAIT_MS}ms; stopping the daily check for account ${accountId}. Remaining files are handled by the next run.`,
            span,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, BATCH_WAIT_POLL_MS));
      }

      const { files, total } = await FileDataListForAccountPaginated(
        span,
        accountId,
        page,
        pageSize,
      );

      if (files.length === 0) {
        break;
      }

      for (const file of files) {
        try {
          await SyncFileCacheCheckFile(
            span,
            account,
            file,
            SyncQueueItemPriority.BATCH,
          );
          totalQueued++;
        } catch (error) {
          logger.error(
            `Error checking file ${file.id} for missing thumbnail/preview`,
            error,
            span,
          );
        }
      }

      page++;
      if (page * pageSize >= total) {
        break;
      }
    }

    logger.info(
      `Daily check completed for account ${accountId}: ${totalQueued} files checked for synchronization`,
      span,
    );
  } finally {
    span.end();
  }
}
