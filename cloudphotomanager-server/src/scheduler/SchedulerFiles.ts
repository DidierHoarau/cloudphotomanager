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
import * as _ from "lodash";

let config: Config;
const logger = new Logger("SchedulerFiles");
const syncFileCacheQueue = [];

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
    for (const file of files) {
      const cacheDir = `${config.DATA_DIR}/cache/${file.id[0]}/${file.id[1]}/${file.id}`;
      if (
        File.getMediaType(file.filename) === FileMediaType.image &&
        (!fs.existsSync(`${cacheDir}/thumbnail.webp`) || !fs.existsSync(`${cacheDir}/preview.webp`))
      ) {
        if (!_.find(syncFileCacheQueue, { id: file.id })) {
          logger.info(`Cache missing for ${file.accountId}/${file.id}`);
          syncFileCacheQueue.push({ id: file.id, file, account });
        }
      }
    }
    span.end();
    SchedulerFiles.SyncFileCacheProcessQueue();
  }

  private static async SyncFileCacheProcessQueue() {
    if (syncFileCacheQueue.length === 0) {
      return;
    }
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCacheProcessQueue");
    try {
      const item = syncFileCacheQueue.pop();
      const file = item.file;
      const account = item.account;
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
    SchedulerFiles.SyncFileCacheProcessQueue();
  }

  public static async SyncFileMetadata(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileCache", context);
    const files = await FileData.listForAccount(span, account.getAccountDefinition().id);
    for (const file of files) {
      if (Object.keys(file.metadata).length === 0) {
        await account.updateFileMetadata(span, file);
        await FileData.update(span, file);
      }
    }
    span.end();
  }
}
