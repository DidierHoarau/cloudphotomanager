import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueue } from "./SyncQueue";
import { Timeout } from "../utils-std-ts/Timeout";
import { Folder } from "../model/Folder";

let config: Config;
const logger = new Logger("SyncFileMetadata");

export class SyncFileMetadata {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncFileMetadata_init", context);
    config = configIn;
    span.end();
  }

  public static async startSyncForFolder(context: Span, account: Account, folder: Folder) {
    const span = StandardTracer.startSpan("SyncFileMetadata_startSyncForFolder", context);
    const files = await FileData.listAccountFolder(span, account.getAccountDefinition().id, folder.folderpath);
    for (const file of files) {
      if (Object.keys(file.metadata).length === 0) {
        SyncQueue.push(SyncQueue.TYPE_SYNC_METADATA, file.id, { file, account });
        await Timeout.wait(1);
      }
    }
    span.end();
    await Timeout.wait(1);
    SyncFileMetadata.processQueue();
  }

  private static async processQueue() {
    const queuedItem = SyncQueue.pop(SyncQueue.TYPE_SYNC_METADATA);
    if (!queuedItem) {
      return;
    }
    const span = StandardTracer.startSpan("SchedulerFiles_SyncFileMetadataProcessQueue");
    try {
      const file = queuedItem.file;
      const account = queuedItem.account;
      await account.updateFileMetadata(span, file);
      await FileData.update(span, file);
    } catch (err) {
      logger.error(err);
    }
    span.end();
    await Timeout.wait(1);
    SyncFileMetadata.processQueue();
  }
}
