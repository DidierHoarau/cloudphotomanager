import { Span } from "@opentelemetry/sdk-trace-base";
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
let SOURCE_FETCH_FREQUENCY_DYNAMIC = 30 * 60 * 1000;
let lastCacheRebuildCheck = 0;

export async function SchedulerInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("Scheduler_init", context);
  config = configIn;

  SchedulerStartSchedule();
  OTelMeter().createObservableGauge(
    "photos.files.counts",
    (observableResult) => {
      observableResult.observe(stats.nbFiles, { type: "files" });
      observableResult.observe(stats.nbFolders, { type: "folders" });
    },
    { description: "Number of files" }
  );
  OTelMeter().createObservableGauge(
    "photos.queue.counts",
    (observableResult) => {
      const syncCounts = SyncQueueGetCounts();
      syncCounts.forEach((syncCount) => {
        observableResult.observe(syncCount.count, { type: syncCount.type });
      });
    },
    { description: "Size of the queue" }
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

  // Clean File without folders
  await FileDataDeleteNoFolder(span, account.getAccountDefinition().id);

  // Ensure root folder
  const rootFolderCloud = await account.getFolderByPath(span, "/");
  const rootFolderKnown = await FolderDataGet(span, rootFolderCloud.id);
  if (!rootFolderKnown) {
    rootFolderCloud.dateSync = new Date(0);
    await FolderDataAdd(span, rootFolderCloud);
    SyncQueueQueueItem(
      account.getAccountDefinition().id,
      rootFolderCloud.id,
      rootFolderCloud,
      "SyncInventorySyncFolder",
      SyncQueueItemPriority.NORMAL
    );
  }

  // Collect folders to sync, deduplicating by ID
  const foldersToSync = new Map<string, { folder: any }>();
  const accountId = account.getAccountDefinition().id;

  // Top newest-synced folders
  for (const folder of await FolderDataGetNewestSync(span, accountId, 10)) {
    foldersToSync.set(folder.id, { folder });
  }

  // Top oldest-synced folders
  for (const folder of await FolderDataGetOldestSync(span, accountId, 10)) {
    foldersToSync.set(folder.id, { folder });
  }

  // Outdated folders
  for (const folder of await FolderDataGetOlderThan(
    span,
    accountId,
    new Date(new Date().getTime() - OUTDATED_AGE)
  )) {
    foldersToSync.set(folder.id, { folder });
  }

  // Folders containing newest-updated files
  for (const folder of await FolderDataGetNewstUpdate(span, accountId, 10)) {
    foldersToSync.set(folder.id, { folder });
  }

  // Queue deduplicated folders
  for (const { folder } of foldersToSync.values()) {
    SyncQueueQueueItem(
      accountId,
      folder.id,
      folder,
      "SyncInventorySyncFolder",
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
    for (const accountDefinition of accountDefinitions) {
      logger.info(`Start Sync of Account ${accountDefinition.name}`, span);
      await SchedulerStartAccountSync(span, accountDefinition).catch((err) => {
        logger.error("Error Synchronizing Account", err, span);
      });
    }

    // Check if it's time to run the daily cache rebuild check
    const now = Date.now();
    if (now - lastCacheRebuildCheck >= config.CACHE_REBUILD_FREQUENCY) {
      logger.info(
        `Running daily check for missing thumbnails and previews`,
        span,
      );
      for (const accountDefinition of accountDefinitions) {
        await SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
          span,
          accountDefinition.id,
        ).catch((err) => {
          logger.error(
            `Error running daily cache rebuild check for account ${accountDefinition.name}`,
            err,
            span,
          );
        });
      }
      lastCacheRebuildCheck = now;
    }

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
