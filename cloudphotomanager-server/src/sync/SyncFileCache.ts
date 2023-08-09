import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import * as fs from "fs-extra";
import { Logger } from "../utils-std-ts/Logger";
import { FileMediaType } from "../model/FileMediaType";
import { File } from "../model/File";
import * as sharp from "sharp";
import { SyncQueue } from "./SyncQueue";
import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueItemWeight } from "../model/SyncQueueItemWeight";
import { Config } from "../Config";
import { SystemCommand } from "../SystemCommand";
import * as probe from "node-ffprobe";

const logger = new Logger("SyncFileCache");
let config: Config;

export class SyncFileCache {
  //

  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    span.end();
  }

  public static async checkFolder(context: Span, account: Account, folder: Folder) {
    const span = StandardTracer.startSpan("SyncFileCache_checkFolder", context);
    const files = await FileData.listByFolder(span, account.getAccountDefinition().id, folder.id);
    for (const file of files) {
      this.checkFile(span, account, file);
    }
    span.end();
  }

  public static async checkFile(context: Span, account: Account, file: File, priority = SyncQueueItemPriority.LOW) {
    const span = StandardTracer.startSpan("SyncFileCache_checkFile", context);
    const cacheDir = await FileData.getFileCacheDir(span, file.id);
    const isImage = File.getMediaType(file.filename) === FileMediaType.image;
    const isVideo = File.getMediaType(file.filename) === FileMediaType.video;
    const hasThumbnail = fs.existsSync(`${cacheDir}/thumbnail.webp`);
    const hasImagePreview = fs.existsSync(`${cacheDir}/preview.webp`);
    const hasVideoPreview = fs.existsSync(`${cacheDir}/preview.webm`);
    // const hasVideoPreview = fs.existsSync(`${cacheDir}/preview.mp4`);
    const accountCapabilities = account.getCapabilities();

    if (
      (isImage && !hasThumbnail && accountCapabilities.downloadPhotoThumbnail) ||
      (isVideo && !hasThumbnail && accountCapabilities.downloadVideoThumbnail)
    ) {
      await SyncQueue.queueItem(
        account,
        file.id,
        file,
        SyncFileCache.syncThumbnail,
        priority,
        SyncQueueItemWeight.LIGHT
      );
    }

    if (isImage && !hasImagePreview) {
      await SyncQueue.queueItem(
        account,
        file.id,
        file,
        SyncFileCache.syncPhotoFromFull,
        priority,
        SyncQueueItemWeight.LIGHT
      );
    }

    if (isVideo && !hasVideoPreview) {
      await SyncQueue.queueItem(
        account,
        file.id,
        file,
        SyncFileCache.syncVideoFromFull,
        priority,
        SyncQueueItemWeight.HEAVY
      );
    }

    span.end();
  }

  public static async syncVideoFromFull(account: Account, file: File) {
    const span = StandardTracer.startSpan("SyncFileCache_syncVideoFromFull");
    const cacheDir = await FileData.getFileCacheDir(span, file.id);
    const tmpDir = await FileData.getFileTmpDir(span, file.id);
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
            `${config.TOOLS_DIR}/tools-video-process.sh ${tmpDir}/tmp_preview/${tmpFileName} ${tmpDir}/tmp_preview/${tmpFileName}.webm ${targetWidth}`
          )
        );
        await fs.move(`${tmpDir}/tmp_preview/${tmpFileName}.webm`, `${cacheDir}/preview.webm`);
      })
      .catch((err) => {
        logger.error(err);
      });
    await fs.remove(`${tmpDir}/tmp_preview`);
    span.end();
  }

  public static async syncPhotoFromFull(account: Account, file: File) {
    const span = StandardTracer.startSpan("SyncFileCache_syncPhotoFromFull");
    const cacheDir = await FileData.getFileCacheDir(span, file.id);
    const tmpDir = await FileData.getFileTmpDir(span, file.id);
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

  public static async syncThumbnail(account: Account, file: File) {
    const span = StandardTracer.startSpan("SyncFileCache_syncThumbnail");
    const cacheDir = await FileData.getFileCacheDir(span, file.id);
    const tmpDir = await FileData.getFileTmpDir(span, file.id);
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
}
