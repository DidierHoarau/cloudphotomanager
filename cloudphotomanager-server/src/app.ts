import Fastify from "fastify";
import * as path from "path";
import { watchFile } from "fs-extra";
import { Config } from "./Config";
import { Logger } from "./utils-std-ts/Logger";
import { StandardTracer } from "./utils-std-ts/StandardTracer";
import { UserRoutes } from "./users/UserRoutes";
import { Auth } from "./users/Auth";
import { StandardTracerApi } from "./StandardTracerApi";
import { SqlDbutils } from "./utils-std-ts/SqlDbUtils";
import { AccountRoutes } from "./accounts/AccountRoutes";
import { Scheduler } from "./sync/Scheduler";
import { FileRoutes } from "./files/FileRoutes";
import { FileData } from "./files/FileData";
import { FolderData } from "./folders/FolderData";
import { FolderRoutes } from "./folders/FolderRoutes";
import { SyncRoutes } from "./sync/SyncRoutes";
import { FileOperationsRoutes } from "./files/FileOperationsRoutes";
import { AnalysisData } from "./analysis/AnalysisData";
import { AnalysisRoutes } from "./analysis/AnalysisRoutes";

const logger = new Logger("app");

logger.info("====== Starting CloudPhotoManager Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  StandardTracer.initTelemetry(config);

  const span = StandardTracer.startSpan("init");

  await SqlDbutils.init(span, config);
  await Auth.init(span, config);
  await FileData.init(span, config);
  await FolderData.init(span, config);
  await AnalysisData.init(span, config);
  await Scheduler.init(span, config);

  span.end();

  // API

  const fastify = Fastify({
    logger: config.LOG_LEVEL === "debug_tmp",
    ignoreTrailingSlash: true,
  });

  if (config.CORS_POLICY_ORIGIN) {
    /* eslint-disable-next-line */
    fastify.register(require("@fastify/cors"), {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }
  /* eslint-disable-next-line */
  fastify.register(require("@fastify/multipart"));

  StandardTracerApi.registerHooks(fastify, config);

  fastify.register(new UserRoutes().getRoutes, {
    prefix: "/api/users",
  });

  fastify.register(new AccountRoutes().getRoutes, {
    prefix: "/api/accounts",
  });

  fastify.register(new FileRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/files",
  });

  fastify.register(new FolderRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/folders",
  });

  fastify.register(new FileOperationsRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/files/:fileId/operations",
  });

  fastify.register(new AnalysisRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/analysis",
  });

  fastify.register(new SyncRoutes().getRoutes, {
    prefix: "/api/sync",
  });

  if (process.env.DEV_MODE) {
    /* eslint-disable-next-line */
    fastify.register(require("@fastify/static"), {
      root: path.resolve(path.join(config.DATA_DIR, "/cache/")),
      prefix: "/static",
    });
  }

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error(err);
      fastify.log.error(err);
      process.exit(1);
    }
    logger.info("API Listerning");
  });
});
