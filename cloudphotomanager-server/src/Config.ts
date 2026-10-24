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
  public AUTO_SYNC = process.env.AUTO_SYNC !== "N";
  public DATABASE_ASYNC_WRITE = false;
  public VIDEO_PREVIEW_WIDTH = 900;
  public IMAGE_CLASSIFICATION_ENABLED = true;
  // HuggingFace transformers.js image-classification model. Must be an ONNX
  // model compatible with pipeline("image-classification"). Examples:
  //   "Xenova/mobilenet_v2_1.0_224"      (~14MB, default, fastest)
  //   "Xenova/efficientnet-b0"           (~20MB, better accuracy)
  //   "Xenova/deit-tiny-distilled-patch16-224" (~22MB)
  //   "Xenova/vit-base-patch16-224"      (~340MB, highest accuracy)
  public IMAGE_CLASSIFICATION_MODEL = "Xenova/mobilenet_v2_1.0_224";
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
    this.addConfigField({
      field: "SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR",
    });
    this.addConfigField({ field: "DATABASE_ASYNC_WRITE" });
    this.addConfigField({ field: "VIDEO_PREVIEW_WIDTH" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_ENABLED" });
    this.addConfigField({ field: "IMAGE_CLASSIFICATION_MODEL" });
    this.addConfigField({ field: "CRON_METRIC_REFRESH" });
    this.addConfigField({ field: "CRON_SCAN_DEEP" });
    this.addConfigField({ field: "TRASH_RETENTION_DAYS" });
    this.addConfigField({ field: "CRON_TRASH_PURGE" });
    this.addConfigField({ field: "MEDIA_URL_TTL_SECONDS" });
    this.addConfigField({ field: "MEDIA_CACHE_SECONDS" });
    this.addConfigField({ field: "SYNC_FAILURE_WEBHOOK_URL" });
  }

  public async reload(): Promise<void> {
    await super.reload((msg) => logger.info(msg));
  }
}
