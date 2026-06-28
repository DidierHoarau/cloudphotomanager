import { ConfigBase } from "@devopsplaybook.io/common-utils";
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

  constructor() {
    super("cloudphotomanager-server");
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
  }

  public async reload(): Promise<void> {
    await super.reload((msg) => logger.info(msg));
  }
}
