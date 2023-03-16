import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { FolderData } from "./FolderData";

export class FolderRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetFoldersAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetFoldersAccountIdRequest>("/", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folders = await FolderData.listForAccount(span, req.params.accountId);
      return res.status(200).send({ folders });
    });
  }
}
