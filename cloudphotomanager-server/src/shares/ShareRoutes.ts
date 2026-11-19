import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { File } from "../model/File";
import { OTelLogger } from "../OTelContext";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import {
  FileDataGet,
  FileDataListByFolderPaginated,
  FileDataListByFolderRecursivePaginated,
  FileDataStatsForFolderSubtree,
} from "../files/FileData";
import { FileDownloadStreamOriginal } from "../files/FileDownload";
import {
  BulkZipDownloadFiles,
  BulkZipDedupeNames,
  BulkZipEntryNameBasename,
  BulkZipEntryNameSharedRoot,
  BulkZipItem,
  MAX_BULK_DOWNLOAD_FILES,
} from "../files/BulkZipDownload";
import { FolderDataGet, FolderDataListForAccount } from "../folders/FolderData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import { MediaUrlsAttachForShare } from "../media/MediaUrls";
import {
  ShareDataCreate,
  ShareDataDelete,
  ShareDataGetByToken,
  ShareDataGetForFolder,
  ShareDataListForFolder,
} from "./ShareData";
import {
  ShareScopeArchiveName,
  ShareScopeCanAccessFile,
  ShareScopeCanAccessFolder,
  ShareScopeResolve,
  ShareScopeResolved,
} from "./ShareScope";
import {
  AlbumDataItemsListPaginated,
  AlbumDataStats,
} from "../albums/AlbumData";
import { PaginationParse } from "../utils-std-ts/Pagination";

const logger = OTelLogger().createModuleLogger("ShareRoutes");

// Share management (create/list/revoke) — admin only, like the other folder
// operations. The plain token is returned exactly once, at creation.
export class ShareRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostShareRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
      Body: {
        expiresInDays?: number;
      };
    }
    fastify.post<PostShareRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder Not Found" });
      }
      let expiresInDays: number = null;
      if (req.body?.expiresInDays !== undefined) {
        expiresInDays = Number(req.body.expiresInDays);
        if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: expiresInDays" });
        }
      }
      const created = await ShareDataCreate(
        span,
        req.params.accountId,
        req.params.folderId,
        expiresInDays,
        userSession.userId,
      );
      logger.info(`Share link created for folder ${req.params.folderId}`, span);
      return res.status(201).send({
        shareId: created.share.id,
        sharePath: `/share?t=${encodeURIComponent(created.token)}`,
        dateExpires: created.share.dateExpires
          ? created.share.dateExpires.toISOString()
          : null,
      });
    });

    interface GetShareListRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
      };
    }
    fastify.get<GetShareListRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const folder = await FolderDataGet(span, req.params.folderId);
      if (!folder || folder.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Folder Not Found" });
      }
      const shares = await ShareDataListForFolder(
        span,
        req.params.accountId,
        req.params.folderId,
      );
      return res.status(200).send({
        shares: shares.map((share) => ({
          id: share.id,
          dateCreated: share.dateCreated.toISOString(),
          dateExpires: share.dateExpires
            ? share.dateExpires.toISOString()
            : null,
        })),
      });
    });

    interface DeleteShareRequest extends RequestGenericInterface {
      Params: {
        accountId: string;
        folderId: string;
        shareId: string;
      };
    }
    fastify.delete<DeleteShareRequest>("/:shareId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const share = await ShareDataGetForFolder(
        span,
        req.params.accountId,
        req.params.folderId,
        req.params.shareId,
      );
      if (!share) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      await ShareDataDelete(span, req.params.shareId);
      return res.status(202).send({});
    });
  }
}

function FolderDisplayName(folderpath: string): string {
  return folderpath.split("/").filter(Boolean).pop() || "/";
}

function FileSize(file: File): number {
  const size = Number(file?.info?.size ?? 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

// Builds the validated zip item list for a share, in scope.
async function ShareZipItemsFor(
  span: any,
  share: any,
  resolved: ShareScopeResolved,
  requestedIds: string[] | null,
): Promise<{ items: BulkZipItem[] } | { status: number; error: string }> {
  const byId = new Map<string, BulkZipItem>();
  const addItem = (file: File, folderpath: any, entryName: string | null) => {
    if (entryName === null) {
      return;
    }
    if (!file || byId.has(file.id)) {
      return;
    }
    byId.set(file.id, {
      file,
      folder: { id: file.folderId, folderpath, accountId: file.accountId } as any,
      entryName,
    });
  };

  if (resolved.kind === "folder") {
    const isRequested = (fileId: string) =>
      requestedIds === null || requestedIds.includes(fileId);
    // Download-all covers the whole shared subtree, matching the folder
    // navigation on the share page.
    if (requestedIds === null) {
      const all = await FileDataListByFolderRecursivePaginated(
        span,
        share.accountId,
        resolved.folder.folderpath,
        "desc",
        0,
        MAX_BULK_DOWNLOAD_FILES + 1,
      );
      if (all.total > MAX_BULK_DOWNLOAD_FILES) {
        return {
          status: 400,
          error: `Too many files (max ${MAX_BULK_DOWNLOAD_FILES})`,
        };
      }
      for (const file of all.files) {
        const folder = await FolderDataGet(span, file.folderId);
        if (!folder) {
          continue;
        }
        addItem(
          file,
          folder.folderpath,
          BulkZipEntryNameSharedRoot(
            resolved.folder.folderpath,
            folder,
            file,
          ),
        );
      }
      return { items: Array.from(byId.values()) };
    }
    for (const fileId of requestedIds) {
      if (!isRequested(fileId)) {
        continue;
      }
      const file = await FileDataGet(span, fileId);
      if (!file || !(await ShareScopeCanAccessFile(span, share, file))) {
        return { status: 403, error: "Access Denied" };
      }
      const folder = await FolderDataGet(span, file.folderId);
      if (!folder) {
        return { status: 403, error: "Access Denied" };
      }
      addItem(
        file,
        folder.folderpath,
        BulkZipEntryNameSharedRoot(resolved.folder.folderpath, folder, file),
      );
    }
    return { items: Array.from(byId.values()) };
  }

  if (resolved.kind === "album") {
    const items = await AlbumDataItemsListPaginated(
      span,
      resolved.album.id,
      share.accountId,
      resolved.album.orderMode,
      "desc",
      0,
      MAX_BULK_DOWNLOAD_FILES + 1,
      null,
    );
    if (items.total > MAX_BULK_DOWNLOAD_FILES) {
      return {
        status: 400,
        error: `Too many files (max ${MAX_BULK_DOWNLOAD_FILES})`,
      };
    }
    const selected =
      requestedIds === null
        ? items.files
        : items.files.filter((file) => requestedIds.includes(file.id));
    if (requestedIds !== null) {
      for (const fileId of requestedIds) {
        if (!items.files.some((file) => file.id === fileId)) {
          return { status: 403, error: "Access Denied" };
        }
      }
    }
    for (const file of selected) {
      const folder = await FolderDataGet(span, file.folderId);
      if (!folder) {
        continue;
      }
      addItem(
        file,
        folder.folderpath,
        BulkZipEntryNameBasename(folder, file),
      );
    }
    return { items: BulkZipDedupeNames(Array.from(byId.values())) };
  }

  // Single-file share: only the shared file, whatever the request says.
  if (
    requestedIds !== null &&
    (requestedIds.length !== 1 || requestedIds[0] !== resolved.file.id)
  ) {
    return { status: 403, error: "Access Denied" };
  }
  const folder = await FolderDataGet(span, resolved.file.folderId);
  if (!folder) {
    return { status: 403, error: "Access Denied" };
  }
  addItem(
    resolved.file,
    folder.folderpath,
    BulkZipEntryNameBasename(folder, resolved.file),
  );
  return { items: Array.from(byId.values()) };
}

// Public share endpoints: the token is the credential, no user session is
// involved. Strictly read-only. Unknown, expired and revoked tokens all
// return 404 (no existence oracle); a valid token used on a folder or file
// outside the share scope returns 403.
export class ShareRoutesPublic {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    // Resolves the share and its target, or null when the token is invalid or
    // the shared target no longer exists.
    async function shareFor(span: any, token: string) {
      const share = await ShareDataGetByToken(span, token);
      if (!share) {
        return null;
      }
      const resolved = await ShareScopeResolve(span, share);
      if (!resolved) {
        return null;
      }
      return { share, resolved };
    }

    interface GetShareMetaRequest extends RequestGenericInterface {
      Params: {
        token: string;
      };
    }
    fastify.get<GetShareMetaRequest>("/:token/meta", async (req, res) => {
      const span = OTelRequestSpan(req);
      const resolved = await shareFor(span, req.params.token);
      if (!resolved) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      const { share, resolved: target } = resolved;
      const meta: any = {
        scope: target.kind,
        name: target.name,
        dateExpires: share.dateExpires
          ? share.dateExpires.toISOString()
          : null,
      };
      if (target.kind === "folder") {
        // Only the folder's own name is exposed, never the ancestor paths.
        meta.folderName = FolderDisplayName(target.folder.folderpath);
        const stats = await FileDataStatsForFolderSubtree(
          span,
          share.accountId,
          target.folder.folderpath,
          null,
        );
        meta.photoCount = stats.count;
        meta.totalSize = stats.size;
      } else if (target.kind === "album") {
        meta.albumName = target.album.name;
        const stats = await AlbumDataStats(
          span,
          target.album.id,
          share.accountId,
          null,
        );
        meta.photoCount = stats.count;
        meta.totalSize = stats.size;
      } else {
        meta.fileName = target.file.filename;
        meta.photoCount = 1;
        meta.totalSize = FileSize(target.file);
      }
      return res.status(200).send(meta);
    });

    interface GetShareFoldersRequest extends RequestGenericInterface {
      Params: {
        token: string;
      };
    }
    fastify.get<GetShareFoldersRequest>("/:token/folders", async (req, res) => {
      const span = OTelRequestSpan(req);
      const resolved = await shareFor(span, req.params.token);
      // Folder navigation only exists for folder shares.
      if (!resolved || resolved.resolved.kind !== "folder") {
        return res.status(404).send({ error: "Share Not Found" });
      }
      const accountFolders = await FolderDataListForAccount(
        span,
        resolved.share.accountId,
      );
      const folders = [];
      for (const folder of accountFolders) {
        if (
          await ShareScopeCanAccessFolder(span, resolved.share, folder)
        ) {
          folders.push({ id: folder.id, folderpath: folder.folderpath });
        }
      }
      return res.status(200).send({ folders });
    });

    interface GetShareFilesRequest extends RequestGenericInterface {
      Params: {
        token: string;
        folderId: string;
      };
      Querystring: {
        page?: string;
        pageSize?: string;
        sortOrder?: string;
        includeSubFolders?: string;
      };
    }
    fastify.get<GetShareFilesRequest>(
      "/:token/folders/:folderId/files-recursive",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const pagination = PaginationParse(req.query);
        if (!pagination) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: page or pageSize" });
        }
        const resolved = await shareFor(span, req.params.token);
        if (!resolved || resolved.resolved.kind !== "folder") {
          return res.status(404).send({ error: "Share Not Found" });
        }
        const folder = await FolderDataGet(span, req.params.folderId);
        if (
          !folder ||
          !(await ShareScopeCanAccessFolder(
            span,
            resolved.share,
            folder,
          ))
        ) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const includeSubFolders = req.query.includeSubFolders === "true";
        const sortOrder: "asc" | "desc" =
          req.query.sortOrder === "asc" ? "asc" : "desc";
        const page = pagination.page;
        const pageSize = pagination.pageSize;
        let result: { files: File[]; total: number };
        if (includeSubFolders) {
          result = await FileDataListByFolderRecursivePaginated(
            span,
            resolved.share.accountId,
            folder.folderpath,
            sortOrder,
            page,
            pageSize,
          );
        } else {
          result = await FileDataListByFolderPaginated(
            span,
            resolved.share.accountId,
            folder.id,
            sortOrder,
            page,
            pageSize,
          );
        }
        MediaUrlsAttachForShare(result.files, resolved.share);
        return res.status(200).send({
          files: result.files,
          page,
          pageSize,
          total: result.total,
        });
      },
    );

    // Flat listing of an album share or the single file of a file share: no
    // folder paths and no breadcrumbs.
    interface GetShareItemsRequest extends RequestGenericInterface {
      Params: {
        token: string;
      };
      Querystring: {
        page?: string;
        pageSize?: string;
        sortOrder?: string;
      };
    }
    fastify.get<GetShareItemsRequest>("/:token/items", async (req, res) => {
      const span = OTelRequestSpan(req);
      const pagination = PaginationParse(req.query);
      if (!pagination) {
        return res
          .status(400)
          .send({ error: "Invalid parameter: page or pageSize" });
      }
      const resolved = await shareFor(span, req.params.token);
      if (!resolved) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      const { share, resolved: target } = resolved;
      if (target.kind === "folder") {
        return res.status(404).send({ error: "Share Not Found" });
      }
      if (target.kind === "file") {
        const files = [target.file];
        MediaUrlsAttachForShare(files, share);
        return res.status(200).send({
          files,
          page: 0,
          pageSize: pagination.pageSize,
          total: 1,
        });
      }
      const sortOrder: "asc" | "desc" =
        req.query.sortOrder === "asc" ? "asc" : "desc";
      const result = await AlbumDataItemsListPaginated(
        span,
        target.album.id,
        share.accountId,
        target.album.orderMode,
        sortOrder,
        pagination.page,
        pagination.pageSize,
        null,
      );
      MediaUrlsAttachForShare(result.files, share);
      return res.status(200).send({
        files: result.files,
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: result.total,
        orderMode: target.album.orderMode,
      });
    });

    interface GetShareFileDownloadRequest extends RequestGenericInterface {
      Params: {
        token: string;
        fileId: string;
      };
      Querystring: {
        disposition?: string;
      };
    }
    fastify.get<GetShareFileDownloadRequest>(
      "/:token/files/:fileId/download",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const resolved = await shareFor(span, req.params.token);
        if (!resolved) {
          return res.status(404).send({ error: "Share Not Found" });
        }
        const file = await FileDataGet(span, req.params.fileId);
        if (
          !file ||
          !(await ShareScopeCanAccessFile(span, resolved.share, file))
        ) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const account = await AccountFactoryGetAccountImplementation(
          file.accountId,
        );
        if (!account.getCapabilities().downloadFileOriginal) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const disposition =
          req.query.disposition === "inline" ? "inline" : "attachment";
        await FileDownloadStreamOriginal(span, account, file, res, disposition);
      },
    );

    interface PostShareDownloadRequest extends RequestGenericInterface {
      Params: {
        token: string;
      };
      Body: {
        fileIdList?: string[];
      };
    }
    fastify.post<PostShareDownloadRequest>(
      "/:token/download",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const resolved = await shareFor(span, req.params.token);
        if (!resolved) {
          return res.status(404).send({ error: "Share Not Found" });
        }
        let requestedIds: string[] | null = null;
        if (req.body?.fileIdList !== undefined) {
          if (
            !Array.isArray(req.body.fileIdList) ||
            req.body.fileIdList.length === 0 ||
            req.body.fileIdList.some(
              (id) => typeof id !== "string" || id.length === 0,
            )
          ) {
            return res
              .status(400)
              .send({ error: "Invalid parameter: fileIdList" });
          }
          if (req.body.fileIdList.length > MAX_BULK_DOWNLOAD_FILES) {
            return res.status(400).send({
              error: `Too many files (max ${MAX_BULK_DOWNLOAD_FILES})`,
            });
          }
          requestedIds = Array.from(new Set(req.body.fileIdList));
        }
        const prepared = await ShareZipItemsFor(
          span,
          resolved.share,
          resolved.resolved,
          requestedIds,
        );
        if ("error" in prepared) {
          return res
            .status(prepared.status)
            .send({ error: prepared.error });
        }
        const zipName = `${ShareScopeArchiveName(
          resolved.share,
          resolved.resolved,
        )}.zip`;
        const failure = await BulkZipDownloadFiles(
          span,
          res,
          prepared.items,
          zipName,
        );
        if (failure) {
          return res.status(failure.status).send({ error: failure.error });
        }
      },
    );
  }
}
