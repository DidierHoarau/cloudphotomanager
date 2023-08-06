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

const logger = new Logger("SyncFileCache");

export class SyncFileCache {
  //
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
    // const hasVideoPreview = fs.existsSync(`${cacheDir}/preview.mp4`);
    const accountCapabilities = account.getCapabilities();

    if (
      (isImage && !hasThumbnail && accountCapabilities.downloadPhotoThumbnail) ||
      (isVideo && !hasThumbnail && accountCapabilities.downloadVideoThumbnail)
    ) {
      await SyncQueue.queueItem(account, file.id, file, SyncFileCache.syncThumbnail, priority);
    }

    if (isImage && !hasImagePreview) {
      await SyncQueue.queueItem(account, file.id, file, SyncFileCache.syncPhotoFromFull, priority);
    }

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
    await fs.remove(`${cacheDir}/tmp_preview`);
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
    await fs.remove(`${cacheDir}/tmp_tumbnail`);
    span.end();
  }
}
