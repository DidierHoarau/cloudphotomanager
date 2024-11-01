import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { FileData } from "./FileData";
import * as fs from "fs-extra";
import { AccountFactory } from "../accounts/AccountFactory";
import { SyncFileCacheCheckFile } from "../sync/SyncFileCache";

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
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      // if (!userSession.isAuthenticated) {
      //   return res.status(403).send({ error: "Access Denied" });
      // }

      const cacheDir = await FileData.getFileCacheDir(span, req.params.accountId, req.params.fileId);
      const filepath = `${cacheDir}/thumbnail.webp`;
      if (!fs.existsSync(filepath)) {
        SyncFileCacheCheckFile(
          span,
          await AccountFactory.getAccountImplementation(req.params.accountId),
          await FileData.get(span, req.params.fileId)
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
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      // if (!userSession.isAuthenticated) {
      //   return res.status(403).send({ error: "Access Denied" });
      // }

      const cacheDir = await FileData.getFileCacheDir(span, req.params.accountId, req.params.fileId);
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

    fastify.get("/static/404", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const uri = req.headers["x-original-uri"];
      const fileIdMatch = /\/static\/.\/.\/(.*)\/.*/.exec(uri as string);
      if (fileIdMatch) {
        const file = await FileData.get(span, fileIdMatch[1]);
        const cacheDir = await FileData.getFileCacheDir(span, file.accountId, file.id);
        if (!fs.existsSync(`${cacheDir}/preview.webp`) || !fs.existsSync(`${cacheDir}/thumbnail.webp`)) {
          SyncFileCacheCheckFile(span, await AccountFactory.getAccountImplementation(file.accountId), file);
        }
      }
      return res.status(404).send({ error: "File Not Found" });
    });
  }
}
