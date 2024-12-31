import { Span } from "@opentelemetry/sdk-trace-base";
import {
  FileDataGetFileCacheDir,
  FileDataGetFileTmpDir,
  FileDataListByFolder,
  FileDataListForAccount,
} from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import * as fs from "fs-extra";
import * as path from "path";
import { Logger } from "../utils-std-ts/Logger";
import { FileMediaType } from "../model/FileMediaType";
import { File } from "../model/File";
import { find } from "lodash";
import * as sharp from "sharp";
import { SyncQueueQueueItem } from "./SyncQueue";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { Config } from "../Config";
import { SystemCommand } from "../SystemCommand";
import * as probe from "node-ffprobe";

const logger = new Logger("SyncFileCache");
let config: Config;

export async function SyncFileCacheInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("Scheduler_init", context);
  config = configIn;
  await fs.rm(config.TMP_DIR, { recursive: true, force: true });
  span.end();
}

export async function SyncFileCacheCheckFolder(context: Span, account: Account, folder: Folder) {
  const span = StandardTracerStartSpan("SyncFileCacheCheckFolder", context);
  const files = await FileDataListByFolder(span, account.getAccountDefinition().id, folder.id);
  for (const file of files) {
    SyncFileCacheCheckFile(span, account, file);
  }
  span.end();
}

export async function SyncFileCacheRemoveFile(context: Span, account: Account, file: File) {
  const span = StandardTracerStartSpan("SyncFileCacheRemoveFile", context);
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  await fs.rm(cacheDir, { recursive: true, force: true });
  span.end();
}

export async function SyncFileCacheCheckFile(context: Span, account: Account, file: File) {
  const span = StandardTracerStartSpan("SyncFileCacheCheckFile", context);
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
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
    await SyncQueueQueueItem(account, file.id, file, syncThumbnail, SyncQueueItemPriority.NORMAL);
  }

  if (isImage && !hasImagePreview) {
    await SyncQueueQueueItem(account, file.id, file, syncPhotoFromFull, SyncQueueItemPriority.NORMAL);
  }

  if (isVideo && !hasVideoPreview) {
    await SyncQueueQueueItem(account, file.id, file, syncVideoFromFull, SyncQueueItemPriority.BATCH);
  }

  if (isVideo && hasVideoPreview && !hasThumbnail) {
    await SyncQueueQueueItem(account, file.id, file, syncThumbnailFromVideoPreview, SyncQueueItemPriority.NORMAL);
  }

  span.end();
}

export async function SyncFileCacheCleanUp(context: Span, account: Account) {
  const span = StandardTracerStartSpan("SyncFileCacheCleanUp", context);
  const accountFiles = await FileDataListForAccount(span, account.getAccountDefinition().id);
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
      logger.info(`Cleaning Cache: ${account.getAccountDefinition().id} ${targetFileId}`);
      await fs.remove(cacheFolder);
    }
  }
  span.end();
}

// Private Functions

async function syncVideoFromFull(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncVideoFromFull");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.remove(tmpDir);
  await fs.ensureDir(tmpDir);
  const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
  logger.info(`Caching video ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await account
    .downloadFile(span, file, tmpDir, tmpFileName)
    .then(async () => {
      let targetWidth = config.VIDEO_PREVIEW_WIDTH;
      await probe(`${tmpDir}/${tmpFileName}`)
        .then((probeData) => {
          if (!probeData || !probeData.streams || probeData.streams.length == 0 || !probeData.streams[0].width) {
            return;
          }
          if (probeData.streams[0].width > config.VIDEO_PREVIEW_WIDTH) {
            targetWidth = config.VIDEO_PREVIEW_WIDTH;
          } else {
            targetWidth = probeData.streams[0].width;
          }
        })
        .catch((err) => {
          logger.error(err);
          targetWidth = config.VIDEO_PREVIEW_WIDTH;
        });
      logger.info(
        await SystemCommand.execute(
          `${config.TOOLS_DIR}/tools-video-process.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}.mp4 ${targetWidth}`
        )
      );
      if ((await fs.stat(`${tmpDir}/${tmpFileName}.mp4`)).size === 0) {
        throw new Error("Generated file empty");
      }
      await fs.move(`${tmpDir}/${tmpFileName}.mp4`, `${cacheDir}/preview.mp4`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(tmpDir);
  span.end();
}

async function syncPhotoFromFull(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncPhotoFromFull");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.ensureDir(tmpDir);
  let tmpFileName = `tmp.${file.filename.split(".").pop()}`;
  logger.info(`Caching photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await account
    .downloadFile(span, file, tmpDir, tmpFileName)
    .then(async () => {
      if (File.getMediaType(file.filename) === FileMediaType.imageRaw) {
        logger.info("Converting from RAW");
        logger.info(
          await SystemCommand.execute(
            `${config.TOOLS_DIR}/tools-image-convert-raw.sh ${tmpDir}/${tmpFileName} ${tmpDir}/${tmpFileName}_raw.jpg`
          )
        );
        tmpFileName += "_raw.jpg";
      }
      await sharp(`${tmpDir}/${tmpFileName}`)
        .withMetadata()
        .resize({ width: 300 })
        .toFile(`${cacheDir}/thumbnail.webp`);
      await sharp(`${tmpDir}/${tmpFileName}`).withMetadata().resize({ width: 2000 }).toFile(`${cacheDir}/preview.webp`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(tmpDir);
  span.end();
}

async function syncThumbnail(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncThumbnail");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.ensureDir(`${tmpDir}/tmp_tumbnail`);
  const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
  logger.info(`Caching thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await account
    .downloadThumbnail(span, file, `${tmpDir}/tmp_tumbnail`, tmpFileName)
    .then(async () => {
      await sharp(`${tmpDir}/tmp_tumbnail/${tmpFileName}`)
        .withMetadata()
        .resize({ width: 300 })
        .toFile(`${cacheDir}/thumbnail.webp`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(`${tmpDir}/tmp_tumbnail`);
  span.end();
}

async function syncThumbnailFromVideoPreview(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncThumbnailFromVideoPreview");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.remove(tmpDir);
  await fs.ensureDir(tmpDir);
  logger.info(`Generating video thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await SystemCommand.execute(
    `${config.TOOLS_DIR}/tools-video-generate-thumbnail.sh ${cacheDir}/preview.mp4 ${tmpDir}/thumbnail.jpg`
  )
    .then(async (output: string) => {
      logger.info(output);
      await sharp(`${tmpDir}/thumbnail.jpg`).withMetadata().resize({ width: 300 }).toFile(`${cacheDir}/thumbnail.webp`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(tmpDir);
  span.end();
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
