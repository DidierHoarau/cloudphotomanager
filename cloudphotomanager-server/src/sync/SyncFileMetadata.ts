import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import { SyncQueue } from "./SyncQueue";
import { Timeout } from "../utils-std-ts/Timeout";

let config: Config;
const logger = new Logger("SyncFileMetadata");

export class SyncFileMetadata {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncFileMetadata_init", context);
    config = configIn;
    span.end();
  }

  public static async startSync(context: Span, account: Account) {
    const span = StandardTracer.startSpan("SyncFileMetadata_SyncFileMetadata", context);
    const files = await FileData.listForAccount(span, account.getAccountDefinition().id);
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

  public static async processQueue() {
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
