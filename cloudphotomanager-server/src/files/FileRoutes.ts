import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { FileData } from "./FileData";
import * as fs from "fs-extra";
import { FolderData } from "../folders/FolderData";
import { File } from "../model/File";
import { FileMediaType } from "../model/FileMediaType";
import { SyncQueue } from "../sync/SyncQueue";
import { AccountFactory } from "../accounts/AccountFactory";
import { SyncFileCache } from "../sync/SyncFileCache";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

export class FileRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetFilesAccountIdFileIdThumbnailRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.get<GetFilesAccountIdFileIdThumbnailRequest>("/:fileId/thumbnail", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      // if (!userSession.isAuthenticated) {
      //   return res.status(403).send({ error: "Access Denied" });
      // }

      const cacheDir = await FileData.getFileCacheDir(span, req.params.fileId);
      const filepath = `${cacheDir}/thumbnail.webp`;
      if (!fs.existsSync(filepath)) {
        SyncQueue.queueItem(
          await AccountFactory.getAccountImplementation(req.params.accountId),
          req.params.fileId,
          await FileData.get(span, req.params.fileId),
          SyncFileCache.syncFile,
          SyncQueueItemPriority.MEDIUM
        );
        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header("Content-Disposition", `attachment; filename=${req.params.fileId}.webp`);
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });

    interface GetFilesAccountIdFileIdPreviewRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.get<GetFilesAccountIdFileIdPreviewRequest>("/:fileId/preview", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      // if (!userSession.isAuthenticated) {
      //   return res.status(403).send({ error: "Access Denied" });
      // }

      const cacheDir = await FileData.getFileCacheDir(span, req.params.fileId);
      const filepath = `${cacheDir}/preview.webp`;
      if (!fs.existsSync(filepath)) {
        return res.status(404).send({ error: "File Not Found" });
      }
      const stream = fs.createReadStream(filepath);
      const stats = await fs.statSync(filepath);
      res.header("Content-Disposition", `attachment; filename=${req.params.accountId}.webp`);
      res.header("Content-Length", stats.size);
      res.header("Content-Type", "application/octet-stream");
      return res.send(stream);
    });
  }
}
