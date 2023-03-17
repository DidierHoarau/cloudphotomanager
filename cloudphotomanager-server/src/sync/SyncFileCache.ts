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
import { Timeout } from "../utils-std-ts/Timeout";

let config: Config;
const logger = new Logger("SchedulerFiles");

export class SyncFileCache {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncFileCache_init", context);
    config = configIn;
    span.end();
  }

  public static async startSync(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCache", context);
    const files = await FileData.listForAccount(span, account.getAccountDefinition().id);
    for (const file of files) {
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      if (
        File.getMediaType(file.filename) === FileMediaType.image &&
        (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`))
      ) {
        SyncQueue.push(SyncQueue.TYPE_SYNC_FILE_CACHE, file.id, { file, account });
        await Timeout.wait(1);
      }
    }
    span.end();
    SyncFileCache.processQueue();
  }

  private static async processQueue() {
    const queuedItem = SyncQueue.pop(SyncQueue.TYPE_SYNC_FILE_CACHE);
    if (!queuedItem) {
      return;
    }
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCacheProcessQueue");
    try {
      const file = queuedItem.file;
      const account = queuedItem.account;
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      await fs.ensureDir(cacheDir);
      await fs.ensureDir(`${cacheDir}/tmp`);
      const tmpFileName = `tmp.${file.filename.split(".").pop()}`;
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
    } catch (err) {
      logger.error(err);
    }
    span.end();
    SyncFileCache.processQueue();
  }
}
