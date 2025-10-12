import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { AnalysisDataListAccountDuplicates } from "./AnalysisData";

export class AnalysisRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetFilesAccountIdFileIdThumbnailRequest
      extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetFilesAccountIdFileIdThumbnailRequest>(
      "/duplicates",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const duplicates = await AnalysisDataListAccountDuplicates(
          span,
          req.params.accountId
        );
        return res.send({ duplicates });
      }
    );
  }
}
