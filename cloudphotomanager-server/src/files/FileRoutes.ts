import { FastifyInstance } from "fastify";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AuthGetUserSession } from "../users/Auth";
import { FileDataGet, FileDataGetFileCacheDir } from "./FileData";
import * as fs from "fs-extra";
import { SyncFileCacheCheckAsync } from "../sync/SyncFileCache";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger } from "../OTelContext";
import { File } from "../model/File";
import { FolderDataGet } from "../folders/FolderData";
import { UserPermissionCheckFolderForUser } from "../users/UserPermissionCheck";

const logger = OTelLogger().createModuleLogger("FileRoutes");

// Resolves the file and its folder and checks the requesting user may access
// it. The legacy /api/files URLs do not carry an accountId; the account is
// taken from the file row itself.
async function fileGetAccessible(
  span: Span,
  userId: string,
  fileId: string,
): Promise<File | null> {
  const file = await FileDataGet(span, fileId);
  if (!file) {
    return null;
  }
  const folder = await FolderDataGet(span, file.folderId);
  if (!folder) {
    return null;
  }
  const permitted = await UserPermissionCheckFolderForUser(span, userId, {
    id: folder.id,
    accountId: folder.accountId,
    folderpath: folder.folderpath,
  });
  return permitted ? file : null;
}

export class FileRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        fileId: string;
      };
    }>("/:fileId/thumbnail", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const file = await fileGetAccessible(
        span,
        userSession.userId,
        req.params.fileId,
      );
      if (!file) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const cacheDir = await FileDataGetFileCacheDir(
        span,
        file.accountId,
        req.params.fileId,
      );
      const filepath = `${cacheDir}/thumbnail.webp`;
      if (!fs.existsSync(filepath)) {
        SyncFileCacheCheckAsync(
          file.accountId,
          req.params.fileId,
          SyncQueueItemPriority.INTERACTIVE,
        ).catch((error) => {
          logger.error("Error getting file for thumbnail sync", error);
        });
        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header(
        "Content-Disposition",
        `attachment; filename=${req.params.fileId}.webp`,
      );
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });

    fastify.get<{
      Params: {
        fileId: string;
      };
    }>("/:fileId/preview", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const file = await fileGetAccessible(
        span,
        userSession.userId,
        req.params.fileId,
      );
      if (!file) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const cacheDir = await FileDataGetFileCacheDir(
        span,
        file.accountId,
        req.params.fileId,
      );
      const filepath = `${cacheDir}/preview.webp`;
      if (!fs.existsSync(filepath)) {
        SyncFileCacheCheckAsync(
          file.accountId,
          req.params.fileId,
          SyncQueueItemPriority.INTERACTIVE,
        ).catch((error) => {
          logger.error("Error getting file for thumbnail sync", error);
        });
        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header(
        "Content-Disposition",
        `attachment; filename=${file.accountId}.webp`,
      );
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });

    fastify.get("/static/404", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(404).send({ error: "File Not Found" });
      }
      const uri = req.headers["x-original-uri"];
      const fileIdMatch = /\/static\/(.*)\/.\/.\/(.*)\/.*/.exec(uri as string);
      if (fileIdMatch) {
        const accountId = fileIdMatch[1];
        const fileId = fileIdMatch[2];
        // Only enqueue a cache rebuild for files that exist in the DB and
        // belong to a folder the user may access; anything else stays a
        // plain 404 so the endpoint cannot be used to trigger work.
        const file = await FileDataGet(span, fileId);
        if (file && file.accountId === accountId) {
          const folder = await FolderDataGet(span, file.folderId);
          if (
            folder &&
            (await UserPermissionCheckFolderForUser(span, userSession.userId, {
              id: folder.id,
              accountId: folder.accountId,
              folderpath: folder.folderpath,
            }))
          ) {
            SyncFileCacheCheckAsync(
              accountId,
              fileId,
              SyncQueueItemPriority.INTERACTIVE,
            ).catch((error) => {
              logger.error("Error getting file for thumbnail sync", error);
            });
          }
        }
      }
      return res.status(404).send({ error: "File Not Found" });
    });
  }
}
