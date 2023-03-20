import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { FileData } from "./FileData";
import { AccountFactory } from "../accounts/AccountFactory";
import { AccountData } from "../accounts/AccountData";
import { SyncInventory } from "../sync/SyncInventory";

export class FileOperationsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostFilesAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        fileId: string;
      };
      Body: {
        folderpath: string;
      };
    }
    fastify.put<PostFilesAccountIdRequest>("/folder", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.folderpath) {
        return res.status(400).send({ error: "Missing parameter: folderpath" });
      }
      const file = await FileData.get(span, req.params.fileId);
      if (!file) {
        return res.status(404).send({ error: "File not found" });
      }
      const accountDefinition = await AccountData.get(span, req.params.accountId);
      const account = await AccountFactory.getAccountImplementation(accountDefinition);
      await account.moveFile(span, file, req.body.folderpath);
      // const originFolder = await account.getFolderByPath(span, file.folderpath);
      // const targetFolder = await account.getFolderByPath(span, req.body.folderpath);
      // SyncInventory.startSyncFoldertath(span, account, originFolder);
      // SyncInventory.startSyncFoldertath(span, account, targetFolder);
      // const files = await FileData.listAccountFolder(span, req.params.accountId, req.body.folderpath);
      return res.status(201).send({});
    });
  }
}
