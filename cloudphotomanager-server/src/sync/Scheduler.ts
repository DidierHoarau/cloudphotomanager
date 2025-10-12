import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDataList } from "../accounts/AccountData";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { FileDataGetCount } from "../files/FileData";
import {
  FolderDataAdd,
  FolderDataDeleteFoldersWithDuplicates,
  FolderDataGet,
  FolderDataGetCount,
  FolderDataGetNewestSync,
  FolderDataGetNewstUpdate,
  FolderDataGetOlderThan,
  FolderDataGetOldestSync,
} from "../folders/FolderData";
import { AccountDefinition } from "../model/AccountDefinition";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { TimeoutWait } from "../utils-std-ts/Timeout";
import { SyncEventHistoryGetRecent } from "./SyncEventHistory";
import { SyncFileCacheCleanUp } from "./SyncFileCache";
import { SyncInventoryInit, SyncInventorySyncFolder } from "./SyncInventory";
import { SyncQueueQueueItem } from "./SyncQueue";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("Scheduler");

let config: Config;

const OUTDATED_AGE = 7 * 24 * 3600 * 1000;
let SOURCE_FETCH_FREQUENCY_DYNAMIC = 30 * 60 * 1000;

export async function SchedulerInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("Scheduler_init", context);
  config = configIn;
  SyncInventoryInit(span);
  SchedulerStartSchedule();
  OTelMeter().createObservableGauge(
    "photos.files.counts",
    (observableResult) => {
      observableResult.observe(stats.nbFiles, { type: "files" });
      observableResult.observe(stats.nbFolders, { type: "folders" });
    },
    { description: "Number of files" }
  );
  span.end();
}

export async function SchedulerStartAccountSync(
  context: Span,
  accountDefinition: AccountDefinition
) {
  const span = OTelTracer().startSpan("Scheduler_startAccountSync", context);
  const account = await AccountFactoryGetAccountImplementation(
    accountDefinition.id
  );

  // Ensure root folder
  const rootFolderCloud = await account.getFolderByPath(span, "/");
  const rootFolderKnown = await FolderDataGet(span, rootFolderCloud.id);
  if (!rootFolderKnown) {
    rootFolderCloud.dateSync = new Date(0);
    await FolderDataAdd(span, rootFolderCloud);
    await SyncQueueQueueItem(
      account,
      rootFolderCloud.id,
      rootFolderCloud,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Top Newest sync folder
  for (const folder of await FolderDataGetNewestSync(
    span,
    account.getAccountDefinition().id,
    10
  )) {
    await SyncQueueQueueItem(
      account,
      folder.id,
      folder,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Top oldest sync folder
  for (const folder of await FolderDataGetOldestSync(
    span,
    account.getAccountDefinition().id,
    10
  )) {
    await SyncQueueQueueItem(
      account,
      folder.id,
      folder,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Outdated Folder
  for (const folder of await FolderDataGetOlderThan(
    span,
    account.getAccountDefinition().id,
    new Date(new Date().getTime() - OUTDATED_AGE)
  )) {
    await SyncQueueQueueItem(
      account,
      folder.id,
      folder,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  // Top oldest sync files
  for (const folder of await FolderDataGetNewstUpdate(
    span,
    account.getAccountDefinition().id,
    10
  )) {
    await SyncQueueQueueItem(
      account,
      folder.id,
      folder,
      SyncInventorySyncFolder,
      SyncQueueItemPriority.NORMAL
    );
  }

  await SyncFileCacheCleanUp(span, account);

  span.end();
}

// Private Functions

async function SchedulerStartSchedule() {
  SOURCE_FETCH_FREQUENCY_DYNAMIC = config.SOURCE_FETCH_FREQUENCY;

  while (true) {
    const span = OTelTracer().startSpan("SchedulerStartSchedule");

    await FolderDataDeleteFoldersWithDuplicates(span);

    const accountDefinitions = await AccountDataList(span);
    accountDefinitions.forEach(async (accountDefinition) => {
      logger.info(`Start Sync of Account ${accountDefinition.name}`, span);
      await SchedulerStartAccountSync(span, accountDefinition).catch((err) => {
        logger.error("Error Synchronizing Account", err, span);
      });
    });
    const lastUpdates = await SyncEventHistoryGetRecent();
    if (
      lastUpdates.length === 0 ||
      lastUpdates[0].date <
        new Date(new Date().getTime() - SOURCE_FETCH_FREQUENCY_DYNAMIC)
    ) {
      SOURCE_FETCH_FREQUENCY_DYNAMIC = Math.min(
        SOURCE_FETCH_FREQUENCY_DYNAMIC + config.SOURCE_FETCH_FREQUENCY,
        config.SOURCE_FETCH_FREQUENCY *
          config.SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR
      );
    } else {
      SOURCE_FETCH_FREQUENCY_DYNAMIC = config.SOURCE_FETCH_FREQUENCY;
    }
    logger.info(
      `Next Sync in ${SOURCE_FETCH_FREQUENCY_DYNAMIC / 60000} minutes`,
      span
    );
    await SchedulerUpdateStats(span);
    span.end();
    await TimeoutWait(SOURCE_FETCH_FREQUENCY_DYNAMIC);
  }
}

async function SchedulerUpdateStats(context: Span) {
  const span = OTelTracer().startSpan("SchedulerUpdateStats", context);
  stats.nbFolders = await FolderDataGetCount(span);
  stats.nbFiles = await FileDataGetCount(span);
  span.end();
}

const stats = {
  nbFiles: 0,
  nbFolders: 0,
};
