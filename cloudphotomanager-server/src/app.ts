import type { FastifyCookieOptions } from "@fastify/cookie";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { AccountRoutes } from "./accounts/AccountRoutes";
import { AnalysisRoutes } from "./analysis/AnalysisRoutes";
import { Config } from "./Config";
import { FileDataInit } from "./files/FileData";
import { FileRoutes } from "./files/FileRoutes";
import { RoutesFileOperationsDelete } from "./files/RoutesFileOperationsDelete";
import { RoutesFileOperationsFolderMove } from "./files/RoutesFileOperationsFolderMove";
import { RoutesFileOperationsRebuildCache } from "./files/RoutesFileOperationsRebuildCache";
import { RoutesFileOperationsRename } from "./files/RoutesFileOperationsRename";
import { FolderDataInit } from "./folders/FolderData";
import { FolderRoutes } from "./folders/FolderRoutes";
import { StandardTracerApi } from "./StandardTracerApi";
import { SchedulerInit } from "./sync/Scheduler";
import { SyncFileCacheInit } from "./sync/SyncFileCache";
import { SyncRoutes } from "./sync/SyncRoutes";
import { AuthInit } from "./users/Auth";
import { UserRoutes } from "./users/UserRoutes";
import { Logger } from "./utils-std-ts/Logger";
import { SqlDbutils } from "./utils-std-ts/SqlDbUtils";
import { StandardTracerInitTelemetry, StandardTracerStartSpan } from "./utils-std-ts/StandardTracer";

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

  StandardTracerInitTelemetry(config);

  const span = StandardTracerStartSpan("init");

  await SyncFileCacheInit(span, config);
  await SqlDbutils.init(span, config);
  await AuthInit(span, config);
  await FileDataInit(span, config);
  await FolderDataInit(span);
  await SchedulerInit(span, config);

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

  fastify.register(cookie, {
    secret: config.JWT_KEY,
    parseOptions: {},
  } as FastifyCookieOptions);

  StandardTracerApi.registerHooks(fastify, config);

  fastify.register(new UserRoutes().getRoutes, {
    prefix: "/api/users",
  });

  fastify.register(new AccountRoutes().getRoutes, {
    prefix: "/api/accounts",
  });

  fastify.register(new FileRoutes().getRoutes, {
    prefix: "/api/files",
  });

  fastify.register(new FolderRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/folders",
  });

  fastify.register(new RoutesFileOperationsDelete().getRoutes, {
    prefix: "/api/accounts/:accountId/files/batch/operations/fileDelete",
  });

  fastify.register(new RoutesFileOperationsFolderMove().getRoutes, {
    prefix: "/api/accounts/:accountId/files/batch/operations/folderMove",
  });

  fastify.register(new RoutesFileOperationsRename().getRoutes, {
    prefix: "/api/accounts/:accountId/files/batch/operations/fileRename",
  });

  fastify.register(new RoutesFileOperationsRebuildCache().getRoutes, {
    prefix: "/api/accounts/:accountId/files/batch/operations/fileCacheDelete",
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
