import { Span } from "@opentelemetry/sdk-trace-base";
import exifReader from "exif-reader";
import * as fs from "fs-extra";
import { find } from "lodash";
import * as probe from "node-ffprobe";
import * as path from "path";
import sharp from "sharp";
import { AnalysisImagesGetLabels } from "../analysis/AnalysisImages";
import { Config } from "../Config";
import {
  FileDataGet,
  FileDataGetFileCacheDir,
  FileDataGetFileTmpDir,
  FileDataListByFolder,
  FileDataListForAccount,
  FileDataListForAccountPaginated,
  FileDataUpdateInfo,
  FileDataUpdateKeywords,
} from "../files/FileData";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { FileMediaType } from "../model/FileMediaType";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SystemCommand } from "../SystemCommand";
import { SyncQueueQueueItem } from "./SyncQueue";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncQueueGetBatchWaitingCount } from "./SyncQueue";

const logger = OTelLogger().createModuleLogger("SyncFileCache");
let config: Config;

export async function SyncFileCacheInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("SyncFileCacheInit", context);
  config = configIn;

  // Function registration moved to SyncQueueInit

  await fs.rm(config.TMP_DIR, { recursive: true, force: true });
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
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id,
  );
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
  const accountFiles = await FileDataListForAccount(
    span,
    account.getAccountDefinition().id,
  );
  const accountCacheRoot = `${config.DATA_DIR}/cache/${account.getAccountDefinition().id}/`;
  if (!fs.existsSync(accountCacheRoot)) {
    return;
  }
  const cacheFolders = listFoldersRecursively(accountCacheRoot);
  for (const cacheFolder of cacheFolders) {
    const targetFileId = path.basename(cacheFolder);
    if (
      targetFileId &&
      countSlashesInPath(cacheFolder.replace(accountCacheRoot, "")) === 2 &&
      !find(accountFiles, { id: targetFileId })
    ) {
      logger.info(
        `Cleaning Cache: ${account.getAccountDefinition().id} ${targetFileId}`,
        span,
      );
      await fs.remove(cacheFolder);
    }
  }
  span.end();
}

// Private Functions

async function getVideoWidthWithFfprobe(
  context: Span,
  filePath: string,
): Promise<number | null> {
  const span = OTelTracer().startSpan("getVideoWidthWithFfprobe", context);
  try {
    const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "${filePath}"`;
    const ffprobeOutput = await SystemCommand.execute(ffprobeCmd);
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

export async function syncVideoFromFull(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncVideoFromFull");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    const tmpDir = await FileDataGetFileTmpDir(
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
        );
        if (width !== null) {
          if (width > config.VIDEO_PREVIEW_WIDTH) {
            targetWidth = config.VIDEO_PREVIEW_WIDTH;
          } else {
            targetWidth = width;
          }
        }
        logger.info(
          await SystemCommand.execute(
            `${config.TOOLS_DIR}/tools-video-process.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}.mp4 ${targetWidth}`,
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
        logger.error("Error Synchronizing Video", err, span);
      });
    await fs.remove(tmpDir);
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    throw new Error("syncVideoFromFull Failed");
  }
}

export async function syncPhotoFromFull(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncPhotoFromFull");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    const tmpDir = await FileDataGetFileTmpDir(
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
            await SystemCommand.execute(
              `${config.TOOLS_DIR}/tools-image-convert-raw.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}_raw.jpg`,
            ),
            span,
          );
          tmpFileName += "_raw.jpg";
        }
        // Extract and store EXIF from the source file before rotating
        try {
          const srcMeta = await sharp(`${tmpDir}/${tmpFileName}`).metadata();
          if (srcMeta && srcMeta.exif) {
            file.info.exif = exifReader(srcMeta.exif);
          }
        } catch (_) {
          logger.info(
            `No exif metadata for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
          );
        }
        await FileDataUpdateInfo(span, file);
        // Auto-rotate pixels based on EXIF orientation tag, then strip it
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
      })
      .catch((err) => {
        logger.error("Error Synchronizing Photo", err, span);
      });
    await fs.remove(tmpDir);
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    throw new Error("syncPhotoFromFull Failed");
  }
}

export async function syncPhotoKeyWords(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncPhotoKeyWords");
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id,
  );
  const tmpDir =
    (await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    )) + "_image_classification";
  const hasImagePreview = fs.existsSync(`${cacheDir}/preview.webp`);
  file.keywords = file.filename;

  if (config.IMAGE_CLASSIFICATION_ENABLED) {
    if (!hasImagePreview) {
      await syncPhotoFromFull(account, file);
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
        try {
          const metadata = await sharp(`${cacheDir}/preview.webp`).metadata();
          if (metadata && metadata.exif) {
            const exif = exifReader(
              (await sharp(`${cacheDir}/preview.webp`).metadata()).exif,
            );

            file.info.exif = exif;
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {
          logger.info(
            `No exif metadata for photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
          );
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
        logger.error(err);
      });
    await fs.remove(tmpDir);
  }
  await FileDataUpdateKeywords(span, file);
  span.end();
}

export async function syncThumbnail(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncThumbnail");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    const tmpDir = await FileDataGetFileTmpDir(
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
    await account
      .downloadThumbnail(span, file, `${tmpDir}/tmp_tumbnail`, tmpFileName)
      .then(async () => {
        await sharp(`${tmpDir}/tmp_tumbnail/${tmpFileName}`)
          .rotate()
          .withMetadata()
          .resize({ width: 300 })
          .toFile(`${cacheDir}/thumbnail.webp`);
      })
      .catch((err) => {
        logger.error("Error Synchronizing Thumbnail", err, span);
      });
    await fs.remove(`${tmpDir}/tmp_tumbnail`);
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    throw new Error("syncThumbnail Failed");
  }
}

export async function syncThumbnailFromVideoPreview(
  account: Account,
  file: File,
) {
  const span = OTelTracer().startSpan("syncThumbnailFromVideoPreview");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id,
    );
    const tmpDir = await FileDataGetFileTmpDir(
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
    await SystemCommand.execute(
      `${config.TOOLS_DIR}/tools-video-generate-thumbnail.sh ${cacheDir}/preview.mp4 ${tmpDir}/thumbnail.jpg`,
    )
      .then(async (output: string) => {
        logger.info(output, span);
        await sharp(`${tmpDir}/thumbnail.jpg`)
          .withMetadata()
          .resize({ width: 300 })
          .toFile(`${cacheDir}/thumbnail.webp`);
      })
      .catch((err) => {
        logger.error("Error Generating Video Thumbnail", err, span);
      });
    await fs.remove(tmpDir);
    span.end();
  } catch (errSync) {
    span.setStatus({ code: 2, message: errSync.message });
    span.recordException(errSync);
    span.end();
    throw new Error("syncThumbnailFromVideoPreview Failed");
  }
}

// Private Fucntions

function listFoldersRecursively(folderPath: string) {
  const folders = [];

  function traverseDirectory(currentPath: string) {
    const files = fs.readdirSync(currentPath);

    files.forEach((file) => {
      const filePath = path.join(currentPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        folders.push(filePath);
        traverseDirectory(filePath);
      }
    });
  }

  traverseDirectory(folderPath);
  return folders;
}

function countSlashesInPath(folderPath: string) {
  let count = 0;
  for (const char of folderPath) {
    if (char === "/") {
      count++;
    }
  }
  return count;
}

export async function SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
  context: Span,
  accountId: string,
) {
  const BATCH_MAX_QUEUE_SIZE = 20;
  const BATCH_WAIT_MS = 60_000;
  const span = OTelTracer().startSpan(
    "SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews",
    context,
  );

  logger.info(
    `Starting daily check for files missing thumbnails or previews for account ${accountId}`,
    span,
  );

  const pageSize = 20;
  let page = 0;
  let totalQueued = 0;
  const account = await AccountFactoryGetAccountImplementation(accountId);

  while (true) {
    // Wait until the batch queue has drained below the threshold before adding more
    while (SyncQueueGetBatchWaitingCount() >= BATCH_MAX_QUEUE_SIZE) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_WAIT_MS));
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

  span.end();
}
