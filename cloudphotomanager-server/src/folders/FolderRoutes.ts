import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountFactory } from "../accounts/AccountFactory";
import { FileData } from "../files/FileData";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncInventory } from "../sync/SyncInventory";
import { SyncQueue } from "../sync/SyncQueue";
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

    interface GetAccountIdFolderIdFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
    }
    fastify.get<GetAccountIdFolderIdFilesRequest>("/:folderId/files", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderData.get(span, req.params.accountId, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const files = await FileData.listByFolder(span, req.params.accountId, req.params.folderId);
      return res.status(200).send({ files });
    });

    interface PutAccountIdFolderIdSyncRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
    }
    fastify.put<PutAccountIdFolderIdSyncRequest>("/:folderId/sync", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderData.get(span, req.params.accountId, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const account = await AccountFactory.getAccountImplementation(req.params.accountId);
      SyncQueue.queueItem(account, folder.id, folder, SyncInventory.syncFolder, SyncQueueItemPriority.HIGH);

      return res.status(200).send({});
    });
  }
}
