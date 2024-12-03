import { Span } from "@opentelemetry/sdk-trace-base";
import { FileDataGetFileCacheDir, FileDataGetFileTmpDir, FileDataListByFolder } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import * as fs from "fs-extra";
import { Logger } from "../utils-std-ts/Logger";
import { FileMediaType } from "../model/FileMediaType";
import { File } from "../model/File";
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
  span.end();
}

export async function SyncFileCacheCheckFolder(context: Span, account: Account, folder: Folder) {
  const span = StandardTracerStartSpan("SyncFileCache_checkFolder", context);
  const files = await FileDataListByFolder(span, account.getAccountDefinition().id, folder.id);
  for (const file of files) {
    SyncFileCacheCheckFile(span, account, file);
  }
  span.end();
}

export async function SyncFileCacheCheckFile(context: Span, account: Account, file: File) {
  const span = StandardTracerStartSpan("SyncFileCache_checkFile", context);
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const isImage = File.getMediaType(file.filename) === FileMediaType.image;
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

// Private Functions

async function syncVideoFromFull(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncVideoFromFull");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.remove(`${tmpDir}/tmp_preview`);
  await fs.ensureDir(`${tmpDir}/tmp_preview`);
  const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
  logger.info(`Caching video ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await account
    .downloadFile(span, file, `${tmpDir}/tmp_preview`, tmpFileName)
    .then(async () => {
      let targetWidth = 900;
      await probe(`${tmpDir}/tmp_preview/${tmpFileName}`)
        .then((probeData) => {
          if (!probeData || !probeData.streams || probeData.streams.length == 0 || !probeData.streams[0].width) {
            return;
          }
          if (probeData.streams[0].width > 900) {
            targetWidth = 900;
          } else {
            targetWidth = probeData.streams[0].width;
          }
        })
        .catch((err) => {
          logger.error(err);
          targetWidth = 900;
        });
      logger.info(
        await SystemCommand.execute(
          `${config.TOOLS_DIR}/tools-video-process.sh ${tmpDir}/tmp_preview/${tmpFileName} ${tmpDir}/tmp_preview/${tmpFileName}.mp4 ${targetWidth}`
        )
      );
      await fs.move(`${tmpDir}/tmp_preview/${tmpFileName}.mp4`, `${cacheDir}/preview.mp4`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(`${tmpDir}/tmp_preview`);
  span.end();
}

async function syncPhotoFromFull(account: Account, file: File) {
  const span = StandardTracerStartSpan("syncPhotoFromFull");
  const cacheDir = await FileDataGetFileCacheDir(span, account.getAccountDefinition().id, file.id);
  const tmpDir = await FileDataGetFileTmpDir(span, account.getAccountDefinition().id, file.id);
  await fs.ensureDir(cacheDir);
  await fs.ensureDir(`${tmpDir}/tmp_preview`);
  const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
  logger.info(`Caching photo ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await account
    .downloadFile(span, file, `${tmpDir}/tmp_preview`, tmpFileName)
    .then(async () => {
      await sharp(`${tmpDir}/tmp_preview/${tmpFileName}`)
        .withMetadata()
        .resize({ width: 300 })
        .toFile(`${cacheDir}/thumbnail.webp`);
      await sharp(`${tmpDir}/tmp_preview/${tmpFileName}`)
        .withMetadata()
        .resize({ width: 2000 })
        .toFile(`${cacheDir}/preview.webp`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(`${tmpDir}/tmp_preview`);
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
  await fs.remove(`${tmpDir}/tmp_thumbnail`);
  await fs.ensureDir(`${tmpDir}/tmp_thumbnail`);
  logger.info(`Generating video thumbnail ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
  await SystemCommand.execute(
    `${config.TOOLS_DIR}/tools-video-generate-thumbnail.sh ${cacheDir}/preview.mp4 ${tmpDir}/tmp_thumbnail/thumbnail.jpg`
  )
    .then(async (output: string) => {
      logger.info(output);
      await sharp(`${tmpDir}/tmp_thumbnail/thumbnail.jpg`)
        .withMetadata()
        .resize({ width: 300 })
        .toFile(`${cacheDir}/thumbnail.webp`);
    })
    .catch((err) => {
      logger.error(err);
    });
  await fs.remove(`${tmpDir}/tmp_preview`);
  span.end();
}
