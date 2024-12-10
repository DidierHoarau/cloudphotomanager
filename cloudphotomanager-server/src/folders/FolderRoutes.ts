import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { FolderDataGet, FolderDataListCountsForAccount, FolderDataListForAccount } from "./FolderData";
import { UserPermissionCheck } from "../users/UserPermissionCheck";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import { FileDataListByFolder } from "../files/FileData";
import { AuthGetUserSession } from "../users/Auth";

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
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folders = await UserPermissionCheck.filterFoldersForUser(
        span,
        await FolderDataListForAccount(span, req.params.accountId, true),
        userSession.userId
      );
      return res.status(200).send({ folders });
    });

    interface GetFoldersCountAccountIdRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetFoldersCountAccountIdRequest>("/counts", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const counts = await FolderDataListCountsForAccount(span, req.params.accountId, true);
      return res.status(200).send({ counts });
    });

    interface GetAccountIdFolderIdFilesRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
    }
    fastify.get<GetAccountIdFolderIdFilesRequest>("/:folderId/files", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const files = await FileDataListByFolder(span, req.params.accountId, req.params.folderId);
      return res.status(200).send({ files });
    });

    interface PutAccountIdFolderIdSyncRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
    }
    fastify.put<PutAccountIdFolderIdSyncRequest>("/:folderId/sync", async (req, res) => {
      const span = StandardTracerGetSpanFromRequest(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const account = await AccountFactoryGetAccountImplementation(req.params.accountId);
      SyncQueueQueueItem(account, folder.id, folder, SyncInventorySyncFolder, SyncQueueItemPriority.INTERACTIVE);

      return res.status(200).send({});
    });
  }
}
