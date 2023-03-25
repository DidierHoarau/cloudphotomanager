import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import * as fs from "fs-extra";
import { Logger } from "../utils-std-ts/Logger";
import { FileMediaType } from "../model/FileMediaType";
import { File } from "../model/File";
import * as sharp from "sharp";
import { SyncQueue } from "./SyncQueue";

import { Folder } from "../model/Folder";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

let config: Config;
const logger = new Logger("SyncFileCache");

export class SyncFileCache {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncFileCache_init", context);
    config = configIn;
    span.end();
  }

  public static async checkFolder(context: Span, account: Account, folder: Folder) {
    const span = StandardTracer.startSpan("SyncFileCache_checkFolder", context);
    const files = await FileData.listByFolder(span, account.getAccountDefinition().id, folder.id);
    for (const file of files) {
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      if (
        File.getMediaType(file.filename) === FileMediaType.image &&
        (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`))
      ) {
        await SyncQueue.queueItem(account, file.id, file, SyncFileCache.syncFile, SyncQueueItemPriority.LOW);
      }
    }
    span.end();
  }

  public static async checkFile(context: Span, account: Account, file: File, priority = SyncQueueItemPriority.LOW) {
    const span = StandardTracer.startSpan("SyncFileCache_checkFile", context);
    const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
    if (
      File.getMediaType(file.filename) === FileMediaType.image &&
      (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`))
    ) {
      await SyncQueue.queueItem(account, file.id, file, SyncFileCache.syncFile, priority);
    }
    span.end();
  }

  public static async syncFile(account: Account, file: File) {
    const span = StandardTracer.startSpan("SyncFileCache_SyncFileCacheProcessQueue");
    const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
    await fs.ensureDir(cacheDir);
    await fs.ensureDir(`${cacheDir}/tmp`);
    const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
    logger.info(`Caching file ${account.getAccountDefinition().id} ${file.id} : ${file.filename}`);
    await account
      .downloadFile(span, file, `${cacheDir}/tmp`, tmpFileName)
      .then(async () => {
        await sharp(`${cacheDir}/tmp/${tmpFileName}`).resize({ width: 300 }).toFile(`${cacheDir}/thumbnail.webp`);
        await sharp(`${cacheDir}/tmp/${tmpFileName}`).resize({ width: 2000 }).toFile(`${cacheDir}/preview.webp`);
      })
      .catch((err) => {
        logger.error(err);
      });
    await fs.remove(`${cacheDir}/tmp`);
    span.end();
  }
}
