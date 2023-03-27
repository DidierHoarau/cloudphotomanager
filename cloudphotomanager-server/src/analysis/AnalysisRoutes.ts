import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import * as fs from "fs-extra";
import { File } from "../model/File";
import { AnalysisData } from "./AnalysisData";

export class AnalysisRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetFilesAccountIdFileIdThumbnailRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetFilesAccountIdFileIdThumbnailRequest>("/duplicates", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const duplicates = await AnalysisData.listAccountDuplicates(span, req.params.accountId);
      return res.send({ duplicates });
    });
  }
}
