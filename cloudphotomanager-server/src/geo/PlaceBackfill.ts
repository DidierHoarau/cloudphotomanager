// Backfill of the reverse-geocoded place columns for rows that predate the
// feature (or whose content changed). Runs in-process after boot and on a
// daily cron; idempotent because a row leaves the `placeStatus IS NULL` set
// once it has been processed (either `ok` or `none`).

import { Span } from "@opentelemetry/sdk-trace";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { AccountDataList } from "../accounts/AccountData";
import { File } from "../model/File";
import { FileDataUpdatePlace } from "../files/FileData";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { GEO_PRESENT_CONDITION } from "../analysis/SearchGeoSql";
import { PlaceGeocoderDefault, PlaceGeocoderInstance } from "./PlaceGeocoder";

const logger = OTelLogger().createModuleLogger("PlaceBackfill");

const DEFAULT_BATCH_SIZE = 500;

export interface PlaceBackfillOptions {
  geocoder?: PlaceGeocoderInstance;
  batchSize?: number;
  maxBatches?: number;
}

export interface PlaceBackfillResult {
  accounts: number;
  processed: number;
  ok: number;
  none: number;
}

export async function PlaceBackfillRun(
  context: Span,
  options: PlaceBackfillOptions = {},
): Promise<PlaceBackfillResult> {
  const span = OTelTracer().startSpan("PlaceBackfillRun", context);
  const geocoder = options.geocoder ?? PlaceGeocoderDefault();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: PlaceBackfillResult = {
    accounts: 0,
    processed: 0,
    ok: 0,
    none: 0,
  };
  try {
    const accountDefinitions = await AccountDataList(span);
    for (const accountDefinition of accountDefinitions) {
      result.accounts += 1;
      let batches = 0;
      while (!options.maxBatches || batches < options.maxBatches) {
        batches += 1;
        const rows = await SqlDbUtilsQuerySQL(
          span,
          "SELECT id, info FROM files " +
            " WHERE accountId = ? AND COALESCE(trashed, 0) = 0 " +
            " AND placeStatus IS NULL AND " +
            GEO_PRESENT_CONDITION +
            " LIMIT ? ",
          [accountDefinition.id, batchSize],
        );
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          const file = {
            id: row.id,
            info: row.info ? JSON.parse(row.info) : {},
          } as File;
          try {
            geocoder.fillFile(file);
          } catch (err) {
            logger.warn(
              `Place geocoding failed for file ${row.id}: ${err?.message ?? err}`,
              span,
            );
            continue;
          }
          await FileDataUpdatePlace(span, file);
          result.processed += 1;
          if (file.placeStatus === "ok") {
            result.ok += 1;
          } else {
            result.none += 1;
          }
        }
        // Yield to the event loop so sync work is not starved.
        await new Promise((resolve) => setImmediate(resolve));
        if (rows.length < batchSize) {
          break;
        }
      }
      if (result.processed > 0) {
        logger.info(
          `Place backfill progress: ${result.processed} rows processed ` +
            `(${result.ok} with a place, ${result.none} without)`,
          span,
        );
      }
    }
  } finally {
    span.end();
  }
  return result;
}
