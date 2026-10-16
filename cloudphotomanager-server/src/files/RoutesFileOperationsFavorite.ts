import { FastifyInstance, RequestGenericInterface } from "fastify";
import { FileDataUpdateFavorite } from "./FileData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";

export class RoutesFileOperationsFavorite {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        fileIdList: string[];
        favorite: boolean;
      };
    }
    fastify.post<PostFilesRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }

      if (!req.body.fileIdList || req.body.fileIdList.length === 0) {
        return res.status(400).send({ error: "Missing parameter: fileIdList" });
      }
      if (typeof req.body.favorite !== "boolean") {
        return res.status(400).send({ error: "Missing parameter: favorite" });
      }

      for (const fileId of req.body.fileIdList) {
        await FileDataUpdateFavorite(span, fileId, req.body.favorite);
      }

      return res.status(200).send({});
    });
  }
}
