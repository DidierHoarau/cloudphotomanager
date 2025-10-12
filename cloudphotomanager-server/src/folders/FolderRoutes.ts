import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance } from "fastify";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { FileDataListByFolder } from "../files/FileData";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncInventorySyncFolder } from "../sync/SyncInventory";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { UserPermissionCheckFilterFoldersForUser } from "../users/UserPermissionCheck";
import {
  FolderDataDelete,
  FolderDataGet,
  FolderDataGetParent,
  FolderDataListCountsForAccount,
  FolderDataListForAccount,
} from "./FolderData";

export class FolderRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folders = await UserPermissionCheckFilterFoldersForUser(
        span,
        await FolderDataListForAccount(span, req.params.accountId, true),
        userSession.userId
      );
      return res.status(200).send({ folders });
    });

    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/counts", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const counts = await FolderDataListCountsForAccount(
        span,
        req.params.accountId,
        true
      );
      return res.status(200).send({ counts });
    });

    fastify.get<{
      Params: {
        accountId: string;
        folderId: string;
      };
    }>("/:folderId/files", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const files = await FileDataListByFolder(
        span,
        req.params.accountId,
        req.params.folderId
      );
      return res.status(200).send({ files });
    });

    fastify.put<{
      Params: {
        accountId: string;
        folderId: string;
      };
    }>("/:folderId/sync", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder) {
        return res.status(200).send({ files: [] });
      }
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId
      );
      SyncQueueQueueItem(
        account,
        folder.id,
        folder,
        SyncInventorySyncFolder,
        SyncQueueItemPriority.INTERACTIVE
      );
      return res.status(200).send({});
    });

    fastify.delete<{
      Params: {
        accountId: string;
        folderId: string;
      };
    }>("/:folderId/operations/delete", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (folder.folderpath === "/") {
        return res.status(403).send({ error: "Can not delete root folder" });
      }
      const folderParent = await FolderDataGetParent(span, folder.id);
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId
      );
      account.deleteFolder(span, folder);
      await FolderDataDelete(
        span,
        account.getAccountDefinition().id,
        folder.folderpath
      );
      SyncQueueQueueItem(
        account,
        folder.id,
        folderParent,
        SyncInventorySyncFolder,
        SyncQueueItemPriority.INTERACTIVE
      );
      return res.status(202).send({});
    });
  }
}
