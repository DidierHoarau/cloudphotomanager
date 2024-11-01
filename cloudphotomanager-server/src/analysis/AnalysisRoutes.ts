import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { AnalysisDataListAccountDuplicates } from "./AnalysisData";

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
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const duplicates = await AnalysisDataListAccountDuplicates(span, req.params.accountId);
      return res.send({ duplicates });
    });
  }
}
