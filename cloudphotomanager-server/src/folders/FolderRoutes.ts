import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance } from "fastify";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import { FileDataListByFolder } from "../files/FileData";
import { FileNameValidate } from "../files/PathValidation";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { SyncQueueQueueItem } from "../sync/SyncQueue";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import {
  UserPermissionCheckFilterFoldersForUser,
  UserPermissionContextFolderIdsGet,
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import {
  FolderDataDelete,
  FolderDataGet,
  FolderDataGetByPath,
  FolderDataGetParent,
  FolderDataListCountsForAccount,
  FolderDataListForAccount,
  FolderDataRenameSubtree,
  FolderDataSubtreeExists,
} from "./FolderData";
import {
  FileDataListByFolderPaginated,
  FileDataListByFolderRecursivePaginated,
} from "../files/FileData";
import { File } from "../model/File";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import { OTelLogger } from "../OTelContext";
import { PaginationParse } from "../utils-std-ts/Pagination";
import { PromisePool } from "../utils-std-ts/PromisePool";
import { SyncFileCacheMoveFileCacheDir } from "../sync/SyncFileCache";

const logger = OTelLogger().createModuleLogger("FolderRoutes");

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
        userSession.userId,
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
        true,
      );
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      const permittedFolderIds = await UserPermissionContextFolderIdsGet(
        span,
        permissionContext,
        req.params.accountId,
      );
      if (permittedFolderIds === null) {
        return res.status(200).send({ counts });
      }
      const permittedSet = new Set(permittedFolderIds);
      return res.status(200).send({
        counts: counts.filter((entry) => permittedSet.has(entry.folderId)),
      });
    });

    fastify.get<{
      Params: {
        accountId: string;
        folderId: string;
      };
      Querystring: {
        includeSubFolders?: string;
        sortOrder?: string;
        page?: string;
        pageSize?: string;
        favoriteOnly?: string;
      };
    }>("/:folderId/files-recursive", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const pagination = PaginationParse(req.query);
      if (!pagination) {
        return res
          .status(400)
          .send({ error: "Invalid parameter: page or pageSize" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder) {
        return res
          .status(200)
          .send({ files: [], page: 0, pageSize: 50, total: 0 });
      }
      // The folder must belong to the account in the URL: with
      // includeSubFolders, a grant on an account-A folder must never expose
      // the same-path files of another account.
      if (folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      if (
        !UserPermissionContextFolderIsPermitted(permissionContext, {
          id: folder.id,
          accountId: folder.accountId,
          folderpath: folder.folderpath,
        })
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const includeSubFolders = req.query.includeSubFolders === "true";
      const favoriteOnly = req.query.favoriteOnly === "true";
      const sortOrder: "asc" | "desc" =
        req.query.sortOrder === "asc" ? "asc" : "desc";
      const page = pagination.page;
      const pageSize = pagination.pageSize;
      let result: { files: File[]; total: number };
      if (includeSubFolders) {
        result = await FileDataListByFolderRecursivePaginated(
          span,
          req.params.accountId,
          folder.folderpath,
          sortOrder,
          page,
          pageSize,
          favoriteOnly,
        );
      } else {
        result = await FileDataListByFolderPaginated(
          span,
          req.params.accountId,
          req.params.folderId,
          sortOrder,
          page,
          pageSize,
          favoriteOnly,
        );
      }
      MediaUrlsAttachForUser(result.files, userSession);
      return res.status(200).send({
        files: result.files,
        page,
        pageSize,
        total: result.total,
      });
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
      if (folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      if (
        !UserPermissionContextFolderIsPermitted(permissionContext, {
          id: folder.id,
          accountId: folder.accountId,
          folderpath: folder.folderpath,
        })
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const files = await FileDataListByFolder(
        span,
        req.params.accountId,
        req.params.folderId,
      );
      MediaUrlsAttachForUser(files, userSession);
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
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      if (
        !UserPermissionContextFolderIsPermitted(permissionContext, {
          id: folder.id,
          accountId: folder.accountId,
          folderpath: folder.folderpath,
        })
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId,
      );
      SyncQueueQueueItem(
        account.getAccountDefinition().id,
        folder.id,
        { folderId: folder.id },
        "SyncInventorySyncFolder",
        SyncQueueItemPriority.INTERACTIVE,
      );
      return res.status(200).send({});
    });

    fastify.put<{
      Params: {
        accountId: string;
        folderId: string;
      };
    }>("/:folderId/deep-sync", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      if (
        !UserPermissionContextFolderIsPermitted(permissionContext, {
          id: folder.id,
          accountId: folder.accountId,
          folderpath: folder.folderpath,
        })
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId,
      );
      const allFolders = await FolderDataListForAccount(
        span,
        req.params.accountId,
      );
      const prefix = folder.folderpath === "/" ? "/" : `${folder.folderpath}/`;
      const foldersToSync = allFolders.filter(
        (f) =>
          f.id === folder.id ||
          f.folderpath === folder.folderpath ||
          f.folderpath.startsWith(prefix),
      );
      for (const subFolder of foldersToSync) {
        SyncQueueQueueItem(
          account.getAccountDefinition().id,
          subFolder.id,
          { folderId: subFolder.id },
          "SyncInventorySyncFolder",
          SyncQueueItemPriority.INTERACTIVE,
        );
      }
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
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      if (folder.folderpath === "/") {
        return res.status(403).send({ error: "Can not delete root folder" });
      }
      const folderParent = await FolderDataGetParent(span, folder.id);
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId,
      );
      try {
        await account.deleteFolder(span, folder);
      } catch (error) {
        logger.error("Error deleting folder in cloud storage", error);
        return res
          .status(503)
          .send({ error: "Error deleting folder in cloud storage" });
      }
      await FolderDataDelete(
        span,
        account.getAccountDefinition().id,
        folder.id,
      );
      SyncQueueQueueItem(
        req.params.accountId,
        folder.id,
        { folderId: folderParent.id },
        "SyncInventorySyncFolder",
        SyncQueueItemPriority.INTERACTIVE,
      );
      return res.status(202).send({});
    });

    fastify.put<{
      Params: {
        accountId: string;
        folderId: string;
      };
      Body: {
        newName: string;
      };
    }>("/:folderId/operations/rename", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const newName = (req.body?.newName || "").trim();
      if (!newName) {
        return res.status(400).send({ error: "Missing parameter: newName" });
      }
      if (FileNameValidate(newName)) {
        return res.status(400).send({ error: "Invalid folder name" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder not found" });
      }
      if (folder.folderpath === "/") {
        return res.status(403).send({ error: "Can not rename root folder" });
      }
      const folderParent = await FolderDataGetParent(span, folder.id);
      if (!folderParent) {
        return res.status(404).send({ error: "Parent folder not found" });
      }
      const newFolderpath =
        folderParent.folderpath === "/"
          ? `/${newName}`
          : `${folderParent.folderpath}/${newName}`;
      // Refuse to overwrite an existing destination subtree before touching
      // the cloud: the DB re-key must never collide with existing rows.
      const account = await AccountFactoryGetAccountImplementation(
        req.params.accountId,
      );
      if (
        (await FolderDataGetByPath(
          span,
          account.getAccountDefinition().id,
          newFolderpath,
        )) ||
        (await FolderDataSubtreeExists(
          span,
          account.getAccountDefinition().id,
          newFolderpath,
        ))
      ) {
        return res
          .status(409)
          .send({ error: "A folder already exists at the destination" });
      }
      await account.renameFolder(span, folder, newName);
      const renamedCloud = await account.getFolderByPath(span, newFolderpath);
      const { folderId, fileIdMoves } = await FolderDataRenameSubtree(
        span,
        account.getAccountDefinition().id,
        folder.folderpath,
        newFolderpath,
        renamedCloud?.idCloud ?? null,
      );
      // Cache directories are keyed by file id: move them best-effort after
      // the DB commit so previews are not regenerated.
      const cachePool = new PromisePool(8);
      const cacheMoves = fileIdMoves.map((move) =>
        cachePool.add(async () => {
          await SyncFileCacheMoveFileCacheDir(
            span,
            account.getAccountDefinition().id,
            move.from,
            move.to,
          );
        }),
      );
      await Promise.all(cacheMoves).catch((err) => {
        logger.warn(`Cache move after folder rename failed: ${err?.message}`, span);
      });
      SyncQueueQueueItem(
        req.params.accountId,
        folderId,
        { folderId },
        "SyncInventorySyncFolder",
        SyncQueueItemPriority.INTERACTIVE,
      );
      SyncQueueQueueItem(
        req.params.accountId,
        folderParent.id,
        { folderId: folderParent.id },
        "SyncInventorySyncFolder",
        SyncQueueItemPriority.INTERACTIVE,
      );
      return res.status(202).send({ parentFolderId: folderParent.id });
    });
  }
}
