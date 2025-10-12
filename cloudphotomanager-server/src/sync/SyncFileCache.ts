import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import { find } from "lodash";
import * as path from "path";
import sharp from "sharp";
import { Config } from "../Config";
import {
  FileDataGetFileCacheDir,
  FileDataGetFileTmpDir,
  FileDataListByFolder,
  FileDataListForAccount,
} from "../files/FileData";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { FileMediaType } from "../model/FileMediaType";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SystemCommand } from "../SystemCommand";
import { SyncQueueQueueItem } from "./SyncQueue";

const logger = OTelLogger().createModuleLogger("SyncFileCache");
let config: Config;

export async function SyncFileCacheInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("Scheduler_init", context);
  config = configIn;
  await fs.rm(config.TMP_DIR, { recursive: true, force: true });
  span.end();
}

export async function SyncFileCacheCheckFolder(
  context: Span,
  account: Account,
  folder: Folder
) {
  const span = OTelTracer().startSpan("SyncFileCacheCheckFolder", context);
  const files = await FileDataListByFolder(
    span,
    account.getAccountDefinition().id,
    folder.id
  );
  for (const file of files) {
    SyncFileCacheCheckFile(span, account, file);
  }
  span.end();
}

export async function SyncFileCacheRemoveFile(
  context: Span,
  account: Account,
  file: File
) {
  const span = OTelTracer().startSpan("SyncFileCacheRemoveFile", context);
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id
  );
  await fs.rm(cacheDir, { recursive: true, force: true });
  span.end();
}

export async function SyncFileCacheCheckFile(
  context: Span,
  account: Account,
  file: File
) {
  const span = OTelTracer().startSpan("SyncFileCacheCheckFile", context);
  const cacheDir = await FileDataGetFileCacheDir(
    span,
    account.getAccountDefinition().id,
    file.id
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
      account,
      file.id,
      file,
      syncThumbnail,
      SyncQueueItemPriority.NORMAL
    );
  }

  if (isImage && !hasImagePreview) {
    await SyncQueueQueueItem(
      account,
      file.id,
      file,
      syncPhotoFromFull,
      SyncQueueItemPriority.NORMAL
    );
  }

  if (isVideo && !hasVideoPreview) {
    await SyncQueueQueueItem(
      account,
      file.id,
      file,
      syncVideoFromFull,
      SyncQueueItemPriority.BATCH
    );
  }

  if (isVideo && hasVideoPreview && !hasThumbnail) {
    await SyncQueueQueueItem(
      account,
      file.id,
      file,
      syncThumbnailFromVideoPreview,
      SyncQueueItemPriority.NORMAL
    );
  }

  span.end();
}

export async function SyncFileCacheCleanUp(context: Span, account: Account) {
  const span = OTelTracer().startSpan("SyncFileCacheCleanUp", context);
  const accountFiles = await FileDataListForAccount(
    span,
    account.getAccountDefinition().id
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
        span
      );
      await fs.remove(cacheFolder);
    }
  }
  span.end();
}

// Private Functions

async function getVideoWidthWithFfprobe(
  context: Span,
  filePath: string
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

async function syncVideoFromFull(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncVideoFromFull");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    const tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    await fs.ensureDir(cacheDir);
    await fs.remove(tmpDir);
    await fs.ensureDir(tmpDir);
    const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching video ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span
    );
    await account
      .downloadFile(span, file, tmpDir, tmpFileName)
      .then(async () => {
        let targetWidth = config.VIDEO_PREVIEW_WIDTH;
        const width = await getVideoWidthWithFfprobe(
          span,
          `${tmpDir}/${tmpFileName}`
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
            `${config.TOOLS_DIR}/tools-video-process.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}.mp4 ${targetWidth}`
          ),
          span
        );
        if ((await fs.stat(`${tmpDir}/${tmpFileName}.mp4`)).size === 0) {
          throw new Error("Generated file empty");
        }
        await fs.move(
          `${tmpDir}/${tmpFileName}.mp4`,
          `${cacheDir}/preview.mp4`
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

async function syncPhotoFromFull(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncPhotoFromFull");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    const tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(tmpDir);
    let tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span
    );
    await account
      .downloadFile(span, file, tmpDir, tmpFileName)
      .then(async () => {
        if (File.getMediaType(file.filename) === FileMediaType.imageRaw) {
          logger.info(
            await SystemCommand.execute(
              `${config.TOOLS_DIR}/tools-image-convert-raw.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}_raw.jpg`
            ),
            span
          );
          tmpFileName += "_raw.jpg";
        }
        await sharp(`${tmpDir}/${tmpFileName}`)
          .withMetadata()
          .resize({ width: 300 })
          .toFile(`${cacheDir}/thumbnail.webp`);
        await sharp(`${tmpDir}/${tmpFileName}`)
          .withMetadata()
          .resize({ width: 2000 })
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

async function syncThumbnail(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncThumbnail");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    const tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(`${tmpDir}/tmp_tumbnail`);
    const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(
      `Caching thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span
    );
    await account
      .downloadThumbnail(span, file, `${tmpDir}/tmp_tumbnail`, tmpFileName)
      .then(async () => {
        await sharp(`${tmpDir}/tmp_tumbnail/${tmpFileName}`)
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

async function syncThumbnailFromVideoPreview(account: Account, file: File) {
  const span = OTelTracer().startSpan("syncThumbnailFromVideoPreview");
  try {
    const cacheDir = await FileDataGetFileCacheDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    const tmpDir = await FileDataGetFileTmpDir(
      span,
      account.getAccountDefinition().id,
      file.id
    );
    await fs.ensureDir(cacheDir);
    await fs.remove(tmpDir);
    await fs.ensureDir(tmpDir);
    logger.info(
      `Generating video thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`,
      span
    );
    await SystemCommand.execute(
      `${config.TOOLS_DIR}/tools-video-generate-thumbnail.sh ${cacheDir}/preview.mp4 ${tmpDir}/thumbnail.jpg`
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
