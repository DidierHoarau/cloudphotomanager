import * as fse from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "./utils-std-ts/Logger";
import { ConfigInterface } from "./utils-std-ts/models/ConfigInterface";

const logger = new Logger("config");

export class Config implements ConfigInterface {
  //
  public CONFIG_DIR = process.env.CONFIG_DIR || "/etc/cloudphotomanager";
  public readonly CONFIG_FILE: string = `${this.CONFIG_DIR}/config.json`;
  public readonly SERVICE_ID = "cloudphotomanager-server";
  public VERSION = 1;
  public readonly API_PORT: number = 8080;
  public JWT_VALIDITY_DURATION: number = 31 * 24 * 3600;
  public CORS_POLICY_ORIGIN = "*";
  public DATA_DIR = process.env.DATA_DIR || "/data";
  public TOOLS_DIR = process.env.TOOLS_DIR || "/opt/app/cloudphotomanager/tools";
  public TMP_DIR = process.env.TMP_DIR || "/tmp";
  public JWT_KEY: string = uuidv4();
  public LOG_LEVEL = "info";
  public SOURCE_FETCH_FREQUENCY = 30 * 60 * 1000;
  public OPENTELEMETRY_COLLECTOR_HTTP: string = process.env.OPENTELEMETRY_COLLECTOR_HTTP || "";
  public OPENTELEMETRY_COLLECTOR_AWS = process.env.OPENTELEMETRY_COLLECTOR_AWS === "true";
  public PROCESSORS_SYSTEM = "processors-system";
  public PROCESSORS_USER = "processors-user";
  public AUTO_SYNC = process.env.AUTO_SYNC !== "N";
  public DATABASE_ASYNC_WRITE = false;

  public async reload(): Promise<void> {
    logger.info(`Configuration Value: VERSION: ${this.VERSION}`);
    logger.info(`Configuration Value: CONFIG_FILE: ${this.CONFIG_FILE}`);
    let configContent = {};
    if (!fse.existsSync(this.CONFIG_FILE)) {
      logger.warn(`Configuration file doesn't exist. Using Default values`);
    } else {
      configContent = await fse.readJson(this.CONFIG_FILE);
    }
    const setIfSet = (field: string, displayLog = true) => {
      if (configContent[field]) {
        this[field] = configContent[field];
      }
      if (displayLog) {
        logger.info(`Configuration Value: ${field}: ${this[field]}`);
      } else {
        logger.info(`Configuration Value: ${field}: ********************`);
      }
    };
    setIfSet("JWT_VALIDITY_DURATION");
    setIfSet("CORS_POLICY_ORIGIN");
    setIfSet("DATA_DIR");
    setIfSet("CACHE_DIR");
    setIfSet("JWT_KEY", false);
    setIfSet("LOG_LEVEL");
    setIfSet("SOURCE_FETCH_FREQUENCY");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP");
    setIfSet("OPENTELEMETRY_COLLECTOR_AWS");
    setIfSet("DATABASE_ASYNC_WRITE");
  }
}
