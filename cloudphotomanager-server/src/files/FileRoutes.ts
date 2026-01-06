import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { FileDataGet, FileDataGetFileCacheDir } from "./FileData";
import * as fs from "fs-extra";
import { SyncFileCacheCheckAsync } from "../sync/SyncFileCache";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("FileRoutes");

export class FileRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
        fileId: string;
      };
    }>("/:fileId/thumbnail", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const cacheDir = await FileDataGetFileCacheDir(
        span,
        req.params.accountId,
        req.params.fileId
      );
      const filepath = `${cacheDir}/thumbnail.webp`;
      if (!fs.existsSync(filepath)) {
        SyncFileCacheCheckAsync(
          req.params.accountId,
          req.params.fileId,
          SyncQueueItemPriority.INTERACTIVE
        ).catch((error) => {
          logger.error("Error getting file for thumbnail sync", error);
        });
        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header(
        "Content-Disposition",
        `attachment; filename=${req.params.fileId}.webp`
      );
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });

    fastify.get<{
      Params: {
        accountId: string;
        fileId: string;
      };
    }>("/:fileId/preview", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const cacheDir = await FileDataGetFileCacheDir(
        span,
        req.params.accountId,
        req.params.fileId
      );
      const filepath = `${cacheDir}/preview.webp`;
      if (!fs.existsSync(filepath)) {
        SyncFileCacheCheckAsync(
          req.params.accountId,
          req.params.fileId,
          SyncQueueItemPriority.INTERACTIVE
        ).catch((error) => {
          logger.error("Error getting file for thumbnail sync", error);
        });

        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header(
        "Content-Disposition",
        `attachment; filename=${req.params.accountId}.webp`
      );
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });

    fastify.get("/static/404", async (req, res) => {
      const span = OTelRequestSpan(req);
      const uri = req.headers["x-original-uri"];
      console.log(uri);
      const fileIdMatch = /\/static\/.\/.\/(.*)\/.*/.exec(uri as string);
      if (fileIdMatch) {
        const file = await FileDataGet(span, fileIdMatch[1]);
        const cacheDir = await FileDataGetFileCacheDir(
          span,
          file.accountId,
          file.id
        );
        if (
          !fs.existsSync(`${cacheDir}/preview.webp`) ||
          !fs.existsSync(`${cacheDir}/thumbnail.webp`)
        ) {
          SyncFileCacheCheckAsync(
            file.accountId,
            file.id,
            SyncQueueItemPriority.INTERACTIVE
          ).catch((error) => {
            logger.error("Error getting file for thumbnail sync", error);
          });
        }
      }
      return res.status(404).send({ error: "File Not Found" });
    });
  }
}
