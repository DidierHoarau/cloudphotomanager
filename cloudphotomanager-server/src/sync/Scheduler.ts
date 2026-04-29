import { Span } from "@opentelemetry/sdk-trace-base";
import * as cron from "node-cron";
import { AccountDataList } from "../accounts/AccountData";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { FileDataDeleteNoFolder, FileDataGetCount } from "../files/FileData";
import {
  FolderDataAdd,
  FolderDataDeleteFoldersWithDuplicates,
  FolderDataGet,
  FolderDataGetCount,
  FolderDataGetNewestSync,
  FolderDataGetNewstUpdate,
  FolderDataGetOlderThan,
  FolderDataGetOldestSync,
  FolderDataListForAccount,
} from "../folders/FolderData";
import { AccountDefinition } from "../model/AccountDefinition";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { TimeoutWait } from "../utils-std-ts/Timeout";
import { SyncEventHistoryGetRecent } from "./SyncEventHistory";
import {
  SyncFileCacheCleanUp,
  SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews,
} from "./SyncFileCache";
import { SyncQueueGetCounts, SyncQueueQueueItem } from "./SyncQueue";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("Scheduler");

let config: Config;

const OUTDATED_AGE = 7 * 24 * 3600 * 1000;
const FOLDERS_SYNC_SAMPLE_SIZE = 10;
let SOURCE_FETCH_FREQUENCY_DYNAMIC = 30 * 60 * 1000;

export async function SchedulerInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("Scheduler_init", context);
  config = configIn;

  // Prime count metrics at startup so gauges do not stay at 0 until the first full sync cycle.
  await SchedulerUpdateStats(span).catch((err) => {
    logger.error("Failed to initialize scheduler stats", err, span);
  });

  OTelMeter().createObservableGauge(
    "photos.files.counts",
    (observableResult) => {
      observableResult.observe(stats.nbFiles, { type: "files" });
      observableResult.observe(stats.nbFolders, { type: "folders" });
    },
    { description: "Number of files" },
  );
  OTelMeter().createObservableGauge(
    "photos.queue.counts",
    (observableResult) => {
      const syncCounts = SyncQueueGetCounts();
      syncCounts.forEach((syncCount) => {
        observableResult.observe(syncCount.count, { type: syncCount.type });
      });
    },
    { description: "Size of the queue" },
  );

  // Periodically refresh metric stats so gauges stay current between sync cycles.
  cron.schedule(config.CRON_METRIC_REFRESH, async () => {
    const cronSpan = OTelTracer().startSpan("SchedulerCronMetricRefresh");
    try {
      await SchedulerUpdateStats(cronSpan);
    } catch (err) {
      logger.error("Cron CRON_METRIC_REFRESH error", err, cronSpan);
    } finally {
      cronSpan.end();
    }
  });

  // Daily deep scan: refresh all folders, clean the cache and queue missing
  // thumbnails/previews.
  cron.schedule(config.CRON_SCAN_DEEP, async () => {
    const cronSpan = OTelTracer().startSpan("SchedulerCronScanDeep");
    try {
      await SchedulerRunDeepScan(cronSpan);
    } catch (err) {
      logger.error("Cron CRON_SCAN_DEEP error", err, cronSpan);
    } finally {
      cronSpan.end();
    }
  });

  SchedulerStartSchedule();
  span.end();
}

export async function SchedulerStartAccountSync(
  context: Span,
  accountDefinition: AccountDefinition,
) {
  const span = OTelTracer().startSpan("Scheduler_startAccountSync", context);
  const accountId = accountDefinition.id;
  const account = await AccountFactoryGetAccountImplementation(accountId);

  // Clean File without folders
  await FileDataDeleteNoFolder(span, accountId);

  // Ensure root folder
  const rootFolderCloud = await account.getFolderByPath(span, "/");
  const rootFolderKnown = await FolderDataGet(span, rootFolderCloud.id);
  if (!rootFolderKnown) {
    rootFolderCloud.dateSync = new Date(0);
    await FolderDataAdd(span, rootFolderCloud);
    SyncQueueQueueItem(
      accountId,
      rootFolderCloud.id,
      rootFolderCloud,
      "SyncInventorySyncFolder",
      SyncQueueItemPriority.NORMAL,
    );
  }

  const foldersToSync = await SchedulerCollectFoldersToSync(span, accountId);

  // Queue deduplicated folders
  for (const folder of foldersToSync.values()) {
    SyncQueueQueueItem(
      accountId,
      folder.id,
      folder,
      "SyncInventorySyncFolder",
      SyncQueueItemPriority.NORMAL,
    );
  }

  span.end();
}

// Private Functions

async function SchedulerStartSchedule() {
  SOURCE_FETCH_FREQUENCY_DYNAMIC = config.SOURCE_FETCH_FREQUENCY;

  while (true) {
    const span = OTelTracer().startSpan("SchedulerStartSchedule");

    try {
      await FolderDataDeleteFoldersWithDuplicates(span);

      const accountDefinitions = await AccountDataList(span);
      for (const accountDefinition of accountDefinitions) {
        logger.info(`Start Sync of Account ${accountDefinition.name}`, span);
        await SchedulerStartAccountSync(span, accountDefinition).catch(
          (err) => {
            logger.error("Error Synchronizing Account", err, span);
          },
        );
      }

      const lastUpdates = await SyncEventHistoryGetRecent();
      if (
        lastUpdates.length === 0 ||
        lastUpdates[0].date <
          new Date(Date.now() - SOURCE_FETCH_FREQUENCY_DYNAMIC)
      ) {
        SOURCE_FETCH_FREQUENCY_DYNAMIC = Math.min(
          SOURCE_FETCH_FREQUENCY_DYNAMIC + config.SOURCE_FETCH_FREQUENCY,
          config.SOURCE_FETCH_FREQUENCY *
            config.SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR,
        );
      } else {
        SOURCE_FETCH_FREQUENCY_DYNAMIC = config.SOURCE_FETCH_FREQUENCY;
      }
      logger.info(
        `Next Sync in ${SOURCE_FETCH_FREQUENCY_DYNAMIC / 60000} minutes`,
        span,
      );
      await SchedulerUpdateStats(span);
    } catch (err) {
      logger.error("Scheduler loop error", err, span);
    } finally {
      span.end();
    }

    await TimeoutWait(SOURCE_FETCH_FREQUENCY_DYNAMIC);
  }
}

async function SchedulerRunDeepScan(context: Span) {
  const span = OTelTracer().startSpan("SchedulerRunDeepScan", context);
  const accountDefinitions = await AccountDataList(span);
  for (const accountDefinition of accountDefinitions) {
    logger.info(`Deep scan for account ${accountDefinition.name}`, span);
    try {
      const account = await AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

      // Clear the on-disk cache of stale entries
      await SyncFileCacheCleanUp(span, account);

      // Queue a sync for every known folder (deep scan)
      const folders = await FolderDataListForAccount(
        span,
        accountDefinition.id,
      );
      for (const folder of folders) {
        SyncQueueQueueItem(
          accountDefinition.id,
          folder.id,
          folder,
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.NORMAL,
        );
      }

      // Queue regeneration for any missing thumbnails and previews
      await SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
        span,
        accountDefinition.id,
      );
    } catch (err) {
      logger.error(
        `Error running deep scan for account ${accountDefinition.name}`,
        err,
        span,
      );
    }
  }
  span.end();
}

async function SchedulerUpdateStats(context: Span) {
  const span = OTelTracer().startSpan("SchedulerUpdateStats", context);
  stats.nbFolders = await FolderDataGetCount(span);
  stats.nbFiles = await FileDataGetCount(span);
  span.end();
}

async function SchedulerCollectFoldersToSync(context: Span, accountId: string) {
  const [
    newestSyncedFolders,
    oldestSyncedFolders,
    outdatedFolders,
    newestUpdatedFolders,
  ] = await Promise.all([
    FolderDataGetNewestSync(context, accountId, FOLDERS_SYNC_SAMPLE_SIZE),
    FolderDataGetOldestSync(context, accountId, FOLDERS_SYNC_SAMPLE_SIZE),
    FolderDataGetOlderThan(
      context,
      accountId,
      new Date(Date.now() - OUTDATED_AGE),
    ),
    FolderDataGetNewstUpdate(context, accountId, FOLDERS_SYNC_SAMPLE_SIZE),
  ]);

  const foldersById = new Map<string, any>();
  for (const folder of newestSyncedFolders) {
    foldersById.set(folder.id, folder);
  }
  for (const folder of oldestSyncedFolders) {
    foldersById.set(folder.id, folder);
  }
  for (const folder of outdatedFolders) {
    foldersById.set(folder.id, folder);
  }
  for (const folder of newestUpdatedFolders) {
    foldersById.set(folder.id, folder);
  }

  return foldersById;
}

const stats = {
  nbFiles: 0,
  nbFolders: 0,
};
