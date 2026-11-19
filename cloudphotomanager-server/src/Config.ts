import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

export class Config extends ConfigBase {
  // Project-specific fields
  public TOOLS_DIR =
    process.env.TOOLS_DIR || "/opt/app/cloudphotomanager/tools";
  public TMP_DIR = process.env.TMP_DIR || "/tmp";
  public SOURCE_FETCH_FREQUENCY = 30 * 60 * 1000;
  public SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR = 6;
  // Login token lifetime in seconds: a month, as documented for the app.
  // Pinned and registered through addConfigField so a config reload keeps it
  // instead of falling back to the common-utils default. Still overridable
  // through the environment or the configuration file.
  public JWT_VALIDITY_DURATION = 30 * 24 * 3600;
  public AUTO_SYNC = process.env.AUTO_SYNC !== "N";
  public DATABASE_ASYNC_WRITE = false;
  public VIDEO_PREVIEW_WIDTH = 900;
  // Enrichment is best-effort: disabling it (IMAGE_CLASSIFICATION_ENABLED=N)
  // keeps filename keywords and never blocks media synchronization.
  public IMAGE_CLASSIFICATION_ENABLED =
    process.env.IMAGE_CLASSIFICATION_ENABLED !== "N";
  // HuggingFace transformers.js image-classification model. Must be an ONNX
  // model compatible with pipeline("image-classification"). Examples:
  //   "Xenova/mobilenet_v2_1.0_224"      (~14MB, default, fastest)
  //   "Xenova/efficientnet-b0"           (~20MB, better accuracy)
  //   "Xenova/deit-tiny-distilled-patch16-224" (~22MB)
  //   "Xenova/vit-base-patch16-224"      (~340MB, highest accuracy)
  // A model change takes effect the next time the pipeline is created (after
  // its idle release or a restart), not on live config reload.
  public IMAGE_CLASSIFICATION_MODEL = "Xenova/mobilenet_v2_1.0_224";
  // Local model directory (ONNX layout expected by transformers.js). When set,
  // remote model downloads are disabled and the model is loaded from disk.
  public IMAGE_CLASSIFICATION_MODEL_PATH =
    process.env.IMAGE_CLASSIFICATION_MODEL_PATH || "";
  // HuggingFace-compatible mirror endpoint used when no local model is set.
  public IMAGE_CLASSIFICATION_HF_ENDPOINT =
    process.env.IMAGE_CLASSIFICATION_HF_ENDPOINT || "";
  // Where downloaded model files are cached. Defaults to DATA_DIR/models so
  // the cache survives container restarts when DATA_DIR is a volume.
  public IMAGE_CLASSIFICATION_CACHE_DIR =
    process.env.IMAGE_CLASSIFICATION_CACHE_DIR || "";
  public CRON_METRIC_REFRESH = "*/15 * * * *"; // every 15 minutes
  public CRON_SCAN_DEEP = "0 0 * * *"; // every day at midnight
  // Days a file stays in the Trash before the daily purge permanently
  // deletes it from the cloud storage.
  public TRASH_RETENTION_DAYS = 30;
  public CRON_TRASH_PURGE = "30 3 * * *"; // every day at 3:30 AM
  // Lifetime of the signed media URLs handed out by the API. The signature
  // is bound to the file, the account, the asset and the subject (user
  // session or share) and expires after this many seconds.
  public MEDIA_URL_TTL_SECONDS = 3600;
  // Browser/PWA cache lifetime for media responses. Kept short because
  // revocation is enforced server-side on every request, so a cached copy
  // must not outlive the authorization for long.
  public MEDIA_CACHE_SECONDS = 300;
  // Optional out-of-band webhook fired once per file when it reaches the sync
  // retry cap (see SyncNotifications). Empty = disabled.
  public SYNC_FAILURE_WEBHOOK_URL =
    process.env.SYNC_FAILURE_WEBHOOK_URL || "";
  // Reverse-geocoding backfill: resolves place columns for existing files
  // from the bundled dataset. Runs once after boot and daily afterwards.
  public PLACE_BACKFILL_ENABLED = process.env.PLACE_BACKFILL_ENABLED !== "N";
  public CRON_PLACE_BACKFILL = process.env.CRON_PLACE_BACKFILL || "15 2 * * *";
  public PLACE_BACKFILL_BATCH_SIZE =
    parseInt(process.env.PLACE_BACKFILL_BATCH_SIZE, 10) || 500;

  constructor() {
    super("cloudphotomanager-server");

    // Override VERSION with the app package.json shipped next to dist/ in the
    // container (ConfigBase's own detection cannot find it inside node_modules)
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        this.VERSION = pkg.version;
      }
    } catch {
      // keep default
    }

    this.addConfigField({ field: "TOOLS_DIR" });
    this.addConfigField({ field: "TMP_DIR" });
    this.addConfigField({ field: "SOURCE_FETCH_FREQUENCY" });
    this.addConfigField({ field: "SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR" });
    this.addConfigField({ field: "JWT_VALIDITY_DURATION" });
    this.addConfigField({ field: "DATABASE_ASYNC_WRITE" });
    this.addConfigField({ field: "VIDEO_PREVIEW_WIDTH" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_ENABLED" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_MODEL" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_MODEL_PATH" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_HF_ENDPOINT" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_CACHE_DIR" });
    this.addConfigField({ field: "CRON_METRIC_REFRESH" });
    this.addConfigField({ field: "CRON_SCAN_DEEP" });
    this.addConfigField({ field: "TRASH_RETENTION_DAYS" });
    this.addConfigField({ field: "CRON_TRASH_PURGE" });
    this.addConfigField({ field: "MEDIA_URL_TTL_SECONDS" });
    this.addConfigField({ field: "MEDIA_CACHE_SECONDS" });
    this.addConfigField({ field: "SYNC_FAILURE_WEBHOOK_URL" });
    this.addConfigField({ field: "PLACE_BACKFILL_ENABLED" });
    this.addConfigField({ field: "CRON_PLACE_BACKFILL" });
    this.addConfigField({ field: "PLACE_BACKFILL_BATCH_SIZE" });
  }

  public async reload(): Promise<void> {
    await super.reload((msg) => logger.info(msg));
  }
}
