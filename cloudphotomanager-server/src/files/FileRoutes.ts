import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";

export class FileRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface GetFilesAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetFilesAccountIdRequest>("/", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const accountDefinition = await AccountData.get(span, req.params.accountId);
      const account = await AccountFactory.getAccountImplementation(accountDefinition);
      const files = await account.listFiles(span);
      return res.status(200).send({ files });
    });
  }
}
