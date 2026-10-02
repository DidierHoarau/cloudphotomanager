import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { Span } from "@opentelemetry/sdk-trace-base";
import cookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { FastifyInstance } from "fastify";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { AccountDefinition } from "../model/AccountDefinition";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { User } from "../model/User";
import { UserPermission } from "../model/UserPermission";
import { UserPermissionFolder } from "../model/UserPermissionFolder";
import { OTelLogger, OTelSetTracer, OTelTracer } from "../OTelContext";

export interface RouteSpecContext {
  fastify: FastifyInstance;
  span: Span;
  config: any;
  baseDir: string;
  dataDir: string;
  tmpDir: string;
  rootPath: string;
  userData: typeof import("../users/UserData");
  userPermissionData: typeof import("../users/UserPermissionData");
  userPassword: typeof import("../users/UserPassword");
  auth: typeof import("../users/Auth");
  fileData: typeof import("../files/FileData");
  folderData: typeof import("../folders/FolderData");
  accountData: typeof import("../accounts/AccountData");
  syncQueue: typeof import("../sync/SyncQueue");
  syncFailures: typeof import("../sync/SyncFailures");
  syncFileCache: typeof import("../sync/SyncFileCache");
}

// Boots a real Fastify app (same plugins and routes as App.ts) on a temp
// SQLite database so route specs can run permission flows through inject().
export async function routeSpecSetup(): Promise<RouteSpecContext> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-route-spec-"));
  const dataDir = path.join(baseDir, "data");
  const tmpDir = path.join(baseDir, "tmp");
  const rootPath = path.join(baseDir, "cloud");
  // Set before the dynamic imports below: SyncQueue and SyncFailures read
  // DATA_DIR at module load time.
  process.env.DATA_DIR = dataDir;

  const tracer = new StandardTracer({
    SERVICE_ID: "cloudphotomanager-server-route-spec",
    VERSION: "0.0.0",
  });
  OTelSetTracer(tracer);
  SqlDbUtilsSetOTel(tracer, new StandardLogger());
  const span = OTelTracer().startSpan("RouteSpecHarness");

  await fs.ensureDir(dataDir);
  await fs.ensureDir(tmpDir);
  await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, path.resolve(__dirname, "../../sql"));

  const config: any = {
    DATA_DIR: dataDir,
    TMP_DIR: tmpDir,
    TOOLS_DIR: path.join(baseDir, "tools"),
    VIDEO_PREVIEW_WIDTH: 900,
    IMAGE_CLASSIFICATION_ENABLED: false,
    AUTO_SYNC: false,
    JWT_VALIDITY_DURATION: 3600,
  };

  const syncQueue = await import("../sync/SyncQueue");
  const syncFailures = await import("../sync/SyncFailures");
  const syncFileCache = await import("../sync/SyncFileCache");
  const fileData = await import("../files/FileData");
  const folderData = await import("../folders/FolderData");
  const accountData = await import("../accounts/AccountData");
  const userData = await import("../users/UserData");
  const userPermissionData = await import("../users/UserPermissionData");
  const userPassword = await import("../users/UserPassword");
  const auth = await import("../users/Auth");

  await syncFailures.SyncFailuresInit(span);
  await syncQueue.SyncQueueInit(span);
  await syncFileCache.SyncFileCacheInit(span, config);
  // AuthInit generates and persists JWT_KEY when it is not set, exactly like
  // the real boot path.
  await auth.AuthInit(span, config);
  await fileData.FileDataInit(span, config);
  await folderData.FolderDataInit(span);

  const { UserRoutes } = await import("../users/UserRoutes");
  const { FileRoutes } = await import("../files/FileRoutes");
  const { FolderRoutes } = await import("../folders/FolderRoutes");
  const { SearchRoutes } = await import("../analysis/SearchRoutes");
  const { AnalysisRoutes } = await import("../analysis/AnalysisRoutes");
  const { SyncRoutes } = await import("../sync/SyncRoutes");
  const { SyncFailureRoutes } = await import("../sync/SyncFailureRoutes");

  const fastify = Fastify({});
  await fastify.register(fastifyWebsocket);
  await fastify.register(cookie, {
    secret: config.JWT_KEY,
    parseOptions: {},
  } as any);
  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: [],
  });
  await fastify.register(new UserRoutes().getRoutes, {
    prefix: "/api/users",
  });
  await fastify.register(new FileRoutes().getRoutes, {
    prefix: "/api/files",
  });
  await fastify.register(new FolderRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/folders",
  });
  await fastify.register(new SearchRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/files/search",
  });
  await fastify.register(new AnalysisRoutes().getRoutes, {
    prefix: "/api/accounts/:accountId/analysis",
  });
  await fastify.register(new SyncRoutes().getRoutes, {
    prefix: "/api/sync",
  });
  await fastify.register(new SyncFailureRoutes().getRoutes, {
    prefix: "/api/sync/failures",
  });
  fastify.get("/api/status", async () => {
    return { started: true };
  });
  await fastify.ready();

  return {
    fastify,
    span,
    config,
    baseDir,
    dataDir,
    tmpDir,
    rootPath,
    userData,
    userPermissionData,
    userPassword,
    auth,
    fileData,
    folderData,
    accountData,
    syncQueue,
    syncFailures,
    syncFileCache,
  };
}

export interface RouteSpecUserOptions {
  name: string;
  password: string;
  isAdmin?: boolean;
  grants?: UserPermissionFolder[];
}

export async function routeSpecAddUser(
  ctx: RouteSpecContext,
  options: RouteSpecUserOptions,
): Promise<User> {
  const user = new User();
  user.name = options.name;
  await ctx.userPassword.UserPasswordSetPassword(
    ctx.span,
    user,
    options.password,
  );
  await ctx.userData.UserDataAdd(ctx.span, user);
  const permission = new UserPermission();
  permission.userId = user.id;
  permission.info.isAdmin = options.isAdmin === true;
  permission.info.folders = options.grants || [];
  await ctx.userPermissionData.UserPermissionDataUpdateForUser(
    ctx.span,
    user.id,
    permission,
  );
  return user;
}

export async function routeSpecCreateAccount(
  ctx: RouteSpecContext,
  name: string,
  type = "localDrive",
): Promise<AccountDefinition> {
  const accountDefinition = new AccountDefinition();
  accountDefinition.name = name;
  accountDefinition.rootpath = ctx.rootPath;
  accountDefinition.info = { type };
  accountDefinition.infoPrivate = {};
  await ctx.accountData.AccountDataAdd(ctx.span, accountDefinition);
  return accountDefinition;
}

export async function routeSpecCreateFolder(
  ctx: RouteSpecContext,
  accountId: string,
  folderpath: string,
): Promise<Folder> {
  const folder = new Folder(accountId, folderpath);
  folder.idCloud = path.join(ctx.rootPath, folderpath.replace(/^\//, ""));
  folder.dateSync = new Date();
  folder.dateUpdated = new Date();
  await fs.ensureDir(folder.idCloud);
  await ctx.folderData.FolderDataAdd(ctx.span, folder);
  // The list/counts routes read a debounced cache; refresh it now so seeded
  // fixtures are immediately visible.
  await ctx.folderData.FolderDataRefreshCacheFolders(ctx.span);
  return folder;
}

export async function routeSpecCreateFile(
  ctx: RouteSpecContext,
  accountId: string,
  folder: Folder,
  filename: string,
  hash?: string,
  keywords?: string,
): Promise<File> {
  const file = new File(accountId, folder.id, filename);
  file.idCloud = path.join(folder.idCloud, filename);
  file.hash = hash ?? `hash-${filename}`;
  file.keywords = keywords;
  file.dateSync = new Date();
  file.dateUpdated = new Date();
  file.dateMedia = new Date();
  await fs.writeFile(file.idCloud, "file-content");
  await ctx.fileData.FileDataAdd(ctx.span, file);
  return file;
}

export async function routeSpecSetFileMeta(
  ctx: RouteSpecContext,
  file: File,
  meta: {
    dateMedia?: Date;
    keywords?: string;
    gps?: { latitude: number; longitude: number };
  },
): Promise<void> {
  if (meta.dateMedia) {
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET dateMedia = ? WHERE id = ?",
      [meta.dateMedia.toISOString(), file.id],
    );
  }
  if (meta.keywords !== undefined) {
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET keywords = ? WHERE id = ?",
      [meta.keywords, file.id],
    );
  }
  if (meta.gps) {
    const info = JSON.stringify({
      exif: {
        GPSInfo: {
          GPSLatitudeDecimal: meta.gps.latitude,
          GPSLongitudeDecimal: meta.gps.longitude,
        },
      },
    });
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET info = ? WHERE id = ?",
      [info, file.id],
    );
  }
}

export async function routeSpecTokenFor(
  ctx: RouteSpecContext,
  user: User,
): Promise<string> {
  return ctx.auth.AuthGenerateJWT(ctx.span, user);
}

export function routeSpecAuthHeaders(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export function routeSpecCookieFromResponse(res: {
  headers: Record<string, any>;
}): string {
  const setCookie = ([] as string[]).concat(res.headers["set-cookie"] as any);
  return setCookie[0].split(";")[0];
}
