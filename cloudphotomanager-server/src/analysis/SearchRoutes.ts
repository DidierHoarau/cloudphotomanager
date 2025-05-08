import { FastifyInstance, RequestGenericInterface } from "fastify";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { SearchDataListAccountDuplicates, SearchDataListFiles } from "./SearchData";
import { AuthGetUserSession } from "../users/Auth";

export class SearchRoutes {
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
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const duplicates = await SearchDataListAccountDuplicates(span, req.params.accountId);
      return res.send({ duplicates });
    });

    interface PostFilesSearch extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        filters: any;
      };
    }
    fastify.post<PostFilesSearch>("/", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const files = await SearchDataListFiles(span, req.params.accountId, req.body.filters);
      return res.status(200).send({ files });
    });
  }
}
