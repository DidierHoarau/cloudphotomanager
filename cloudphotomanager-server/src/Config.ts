import { ConfigOTelInterface } from "@devopsplaybook.io/otel-utils";
import * as fse from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { OTelLogger } from "./OTelContext";
import path from "path";

const logger = OTelLogger().createModuleLogger("config");

export class Config implements ConfigOTelInterface {
  //
  public CONFIG_FILE =
    process.env.CONFIG_FILE || "/etc/cloudphotomanager/config.json";
  public readonly SERVICE_ID = "cloudphotomanager-server";
  public VERSION = "1";
  public readonly API_PORT: number = 8080;
  public JWT_VALIDITY_DURATION: number = 31 * 24 * 3600;
  public CORS_POLICY_ORIGIN = "*";
  public DATA_DIR = process.env.DATA_DIR || "/data";
  public TOOLS_DIR =
    process.env.TOOLS_DIR || "/opt/app/cloudphotomanager/tools";
  public TMP_DIR = process.env.TMP_DIR || "/tmp";
  public JWT_KEY: string = uuidv4();
  public LOG_LEVEL = "info";
  public SOURCE_FETCH_FREQUENCY = 30 * 60 * 1000;
  public SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR = 6;
  public OPENTELEMETRY_COLLECTOR_HTTP_TRACES = "";
  public OPENTELEMETRY_COLLECTOR_HTTP_METRICS = "";
  public OPENTELEMETRY_COLLECTOR_HTTP_LOGS = "";
  public OPENTELEMETRY_COLLECTOR_AWS = false;
  public OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS = 60;
  public OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS = 60;
  public OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER = "";
  public AUTO_SYNC = process.env.AUTO_SYNC !== "N";
  public DATABASE_ASYNC_WRITE = false;
  public VIDEO_PREVIEW_WIDTH = 900;
  public IMAGE_CLASSIFICATION_ENABLED = true;

  constructor() {
    let version = "1";
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        version = pkg.version;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // fallback to default "1"
    }
    this.VERSION = version;
  }

  public async reload(): Promise<void> {
    const content = await fse.readJson(this.CONFIG_FILE);
    const setIfSet = (field: string, displayLog = true) => {
      let fromEnv = "defaults";
      if (process.env[field]) {
        this[field] = process.env[field];
        fromEnv = "environment";
      } else if (content[field]) {
        this[field] = content[field];
        fromEnv = "config";
      }
      if (displayLog) {
        logger.info(
          `Configuration Value: ${field}: ${this[field]} (from ${fromEnv})`
        );
      } else {
        logger.info(
          `Configuration Value: ${field}: ******************** (from ${fromEnv})`
        );
      }
    };
    logger.info(`Configuration Value: CONFIG_FILE: ${this.CONFIG_FILE}`);
    logger.info(`Configuration Value: VERSION: ${this.VERSION}`);
    setIfSet("JWT_VALIDITY_DURATION");
    setIfSet("CORS_POLICY_ORIGIN");
    setIfSet("DATA_DIR");
    setIfSet("JWT_KEY", false);
    setIfSet("LOG_LEVEL");
    setIfSet("SOURCE_FETCH_FREQUENCY");
    setIfSet("SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_TRACES");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_METRICS");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_LOGS");
    setIfSet("OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS");
    setIfSet("OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS");
    setIfSet("OPENTELEMETRY_COLLECTOR_AWS");
    setIfSet("OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER", false);
    setIfSet("DATABASE_ASYNC_WRITE");
    setIfSet("VIDEO_PREVIEW_WIDTH");
    setIfSet("IMAGE_CLASSIFICATION_ENABLED");
  }
}
