import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { FileData } from "./FileData";
import * as fs from "fs-extra";

export class FileRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        folderpath: string;
      };
    }
    fastify.post<PostFilesAccountIdRequest>("/search", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const files = await FileData.listAccountFolder(span, req.params.accountId, req.body.folderpath);
      return res.status(200).send({ files });
    });

    interface GetFilesAccountIdFileIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.get<GetFilesAccountIdFileIdRequest>("/:fileId/thumbnail", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      // if (!userSession.isAuthenticated) {
      //   return res.status(403).send({ error: "Access Denied" });
      // }

      const cacheDir = await FileData.getFileCacheDir(span, req.params.fileId);
      const filepath = `${cacheDir}/thumbnail.webp`;
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
