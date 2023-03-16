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
const LIMIT_CACHE_SYNC = 1000;

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
    const syncSummary = { dateStarted: new Date(), added: 0, updated: 0, deleted: 0 };
    for (const cloudFile of cloudFiles) {
      const knownFile = await FileData.getByPath(
        span,
        account.getAccountDefinition().id,
        cloudFile.folderpath,
        cloudFile.filename
      );
      if (!knownFile) {
        syncSummary.added++;
        await FileData.add(span, cloudFile);
      }
    }
    if (syncSummary.added > 0) {
      logger.info(
        `Sync done for ${account.getAccountDefinition().id} in ${
          new Date().getTime() / 1000 - syncSummary.dateStarted.getTime() / 1000
        } s - ${syncSummary.added} added`
      );
    }
    span.end();
  }

  public static async SyncFileCache(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCache", context);
    const files = await FileData.listForAccount(span, account.getAccountDefinition().id);
    let syncCount = 0;
    for (const file of files) {
      if (syncCount >= LIMIT_CACHE_SYNC) {
        break;
      }
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      if (
        File.getMediaType(file.filename) === FileMediaType.image &&
        (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`))
      ) {
        logger.info(`Cache missing for ${file.accountId}/${file.id}`);
        syncCount++;
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
      }
    }
    span.end();
  }
}
