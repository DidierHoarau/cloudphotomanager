import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import type { FastifyCookieOptions } from "@fastify/cookie";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { AnalysisImagesInit } from "./analysis/AnalysisImages";
import { AnalysisRoutes } from "./analysis/AnalysisRoutes";
import { SearchRoutes } from "./analysis/SearchRoutes";
import { Config } from "./Config";
import { FileDataInit } from "./files/FileData";
import { FileRoutes } from "./files/FileRoutes";
import { RoutesFileOperationsDelete } from "./files/RoutesFileOperationsDelete";
import { RoutesFileOperationsFolderMove } from "./files/RoutesFileOperationsFolderMove";
import { RoutesFileOperationsRebuildCache } from "./files/RoutesFileOperationsRebuildCache";
import { RoutesFileOperationsRename } from "./files/RoutesFileOperationsRename";
import { FolderDataInit } from "./folders/FolderData";
import { SchedulerInit } from "./sync/Scheduler";
import { SyncFileCacheInit } from "./sync/SyncFileCache";
import { SyncRoutes } from "./sync/SyncRoutes";
import { AuthInit } from "./users/Auth";
import { UserRoutes } from "./users/UserRoutes";
import { SqlDbUtilsInit } from "./utils-std-ts/SqlDbUtils";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { AccountRoutes } from "./accounts/AccountRoutes";
import { FolderRoutes } from "./folders/FolderRoutes";
import { SyncQueueInit } from "./sync/SyncQueue";

const logger = OTelLogger().createModuleLogger("App");

logger.info("====== Starting CloudPhotoManager Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  const span = OTelTracer().startSpan("init");

  await SqlDbUtilsInit(span, config);
  await SyncQueueInit(span);
  await SyncFileCacheInit(span, config);
  await AuthInit(span, config);
  await FileDataInit(span, config);
  await FolderDataInit(span);
  await SchedulerInit(span, config);
  await AnalysisImagesInit(span, config);

  span.end();

  // API

  const fastify = Fastify({});

  if (config.CORS_POLICY_ORIGIN) {
    fastify.register(cors, {
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

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: ["GET-/api/status"],
  });

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

  fastify.register(new SearchRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/files/search",
  });

  fastify.register(new AnalysisRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/analysis",
  });

  fastify.register(new SyncRoutes().getRoutes, {
    prefix: "/api/sync",
  });

  fastify.get("/api/status", async () => {
    return { started: true };
  });

  if (process.env.DEV_MODE) {
    fastify.register(fastifyStatic, {
      root: path.resolve(path.join(config.DATA_DIR, "/cache/")),
      prefix: "/static",
    });
  }

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
