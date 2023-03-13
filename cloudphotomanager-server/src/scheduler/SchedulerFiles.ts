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

let config: Config;
const logger = new Logger("SchedulerFiles");

export class SchedulerFiles {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    span.end();
  }

  public static async SyncFileInventory(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileInventory", context);
    const cloudFiles = await account.listFiles(span);
    for (const cloudFile of cloudFiles) {
      const knownFile = await FileData.getByPath(span, account.getAccountId(), cloudFile.filepath);
      if (!knownFile) {
        await FileData.add(span, cloudFile);
      }
    }
    span.end();
  }

  public static async SyncFileCache(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCache", context);
    const files = await FileData.listForAccount(span, account.getAccountId());
    for (const file of files) {
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      if (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`)) {
        logger.info(`Cache missing for ${file.accountId}/${file.id}`);
        await fs.ensureDir(cacheDir);
        await fs.ensureDir(`${cacheDir}/tmp`);
        if (File.getMediaType(file.filepath) === FileMediaType.image) {
          const tmpFileName = `tmp.${file.filepath.split(".").pop()}`;
          await account.downloadFile(span, file, `${cacheDir}/tmp`, tmpFileName);
          await sharp(`${cacheDir}/tmp/${tmpFileName}`).resize({ width: 300 }).toFile(`${cacheDir}/thumbnail.webp`);
          await sharp(`${cacheDir}/tmp/${tmpFileName}`).resize({ width: 2000 }).toFile(`${cacheDir}/preview.webp`);
        }
        await fs.remove(`${cacheDir}/tmp`);
      }
    }
    span.end();
  }
}
