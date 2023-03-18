import { Span } from "@opentelemetry/sdk-trace-base";
import { FileData } from "../files/FileData";
import { Account } from "../model/Account";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import * as _ from "lodash";
import { SyncQueue } from "./SyncQueue";

let config: Config;
const logger = new Logger("SyncInventory");

export class SyncInventory {
  //
  public static async init(context: Span, configIn: Config): Promise<void> {
    const span = StandardTracer.startSpan("SyncInventory_init", context);
    config = configIn;
    span.end();
  }

  public static async startSync(context: Span, account: Account): Promise<void> {
    if (SyncQueue.getId(SyncQueue.TYPE_SYNC_INVENTORY, account.getAccountDefinition().id)) {
      return;
    }
    SyncQueue.push(SyncQueue.TYPE_SYNC_INVENTORY, account.getAccountDefinition().id, account);
    const span = StandardTracer.startSpan("SyncInventory_SyncFileInventory", context);
    const cloudFiles = await account.listFiles(span);
    const knownFiles = await FileData.listForAccount(span, account.getAccountDefinition().id);
    const syncSummary = { dateStarted: new Date(), added: 0, updated: 0, deleted: 0 };
    for (const cloudFile of cloudFiles) {
      const knownFile = _.find(knownFiles, { folderpath: cloudFile.folderpath, filename: cloudFile.filename });
      if (!knownFile) {
        syncSummary.added++;
        await FileData.add(span, cloudFile);
      } else if (
        knownFile.dateMedia.getTime() !== cloudFile.dateMedia.getTime() ||
        knownFile.dateUpdated.getTime() !== cloudFile.dateUpdated.getTime() ||
        knownFile.hash !== cloudFile.hash
      ) {
        cloudFile.id = knownFile.id;
        await FileData.update(span, cloudFile);
        syncSummary.updated++;
      }
    }
    for (const knownFile of knownFiles) {
      const cloudFile = _.find(cloudFiles, { folderpath: knownFile.folderpath, filename: knownFile.filename });
      if (!cloudFile) {
        await FileData.delete(span, knownFile.id);
        syncSummary.deleted++;
      }
    }

    if (syncSummary.added > 0 || syncSummary.updated > 0 || syncSummary.deleted > 0) {
      logger.info(
        `Sync done for ${account.getAccountDefinition().id} in ${
          new Date().getTime() / 1000 - syncSummary.dateStarted.getTime() / 1000
        } s - ${syncSummary.added} added ; ${syncSummary.updated} updated ; ${syncSummary.deleted} deleted ; `
      );
    }
    SyncQueue.popId(SyncQueue.TYPE_SYNC_INVENTORY, account.getAccountDefinition().id);
    span.end();
  }
}
