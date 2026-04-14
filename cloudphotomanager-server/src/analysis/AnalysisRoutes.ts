import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import {
  AnalysisDataGetFileDuplicates,
  AnalysisDataListAccountDuplicates,
} from "./AnalysisData";

export class AnalysisRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetAccountDuplicatesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetAccountDuplicatesRequest>(
      "/duplicates",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const duplicates = await AnalysisDataListAccountDuplicates(
          span,
          req.params.accountId,
        );
        return res.send({ duplicates });
      },
    );

    interface GetFileDuplicatesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
    }
    fastify.get<GetFileDuplicatesRequest>(
      "/duplicates/:fileId",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const duplicate = await AnalysisDataGetFileDuplicates(
          span,
          req.params.accountId,
          req.params.fileId,
        );
        return res.send({ duplicate });
      },
    );
  }
}
