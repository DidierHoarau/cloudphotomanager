import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { File } from "../model/File";
import { OTelLogger } from "../OTelContext";
import { AccountFactoryGetAccountImplementation } from "../accounts/AccountFactory";
import {
  FileDataGet,
  FileDataListByFolderPaginated,
  FileDataListByFolderRecursivePaginated,
} from "../files/FileData";
import { FileDownloadStreamOriginal } from "../files/FileDownload";
import { FolderDataGet, FolderDataListForAccount } from "../folders/FolderData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import {
  ShareDataCreate,
  ShareDataDelete,
  ShareDataGetByToken,
  ShareDataListForFolder,
} from "./ShareData";

const logger = OTelLogger().createModuleLogger("ShareRoutes");

// Same subtree rule as folder permissions: a path is in the subtree when it
// is the root itself or nested below it.
function FolderPathIsInSubtree(
  folderpath: string,
  ancestorPath: string,
): boolean {
  if (ancestorPath === "/") {
    return true;
  }
  return (
    folderpath === ancestorPath || folderpath.startsWith(`${ancestorPath}/`)
  );
}

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
      await ShareDataDelete(span, req.params.shareId);
      return res.status(202).send({});
    });
  }
}

// Public share endpoints: the token is the credential, no user session is
// involved. Strictly read-only. Unknown, expired and revoked tokens all
// return 404 (no existence oracle); a valid token used on a folder or file
// outside the shared subtree returns 403.
export class ShareRoutesPublic {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    // Resolves the share and the shared root folder, or null when the token
    // is invalid or the shared folder no longer exists.
    async function shareFor(span: any, token: string) {
      const share = await ShareDataGetByToken(span, token);
      if (!share) {
        return null;
      }
      const shareFolder = await FolderDataGet(span, share.folderId);
      if (!shareFolder) {
        return null;
      }
      return { share, shareFolder };
    }

    // Resolves a folder the share visitor requests; null when it must not be
    // accessed (unknown or outside the subtree).
    async function folderInSubtreeFor(
      span: any,
      share: any,
      shareFolder: any,
      folderId: string,
    ) {
      const folder = await FolderDataGet(span, folderId);
      if (!folder || folder.accountId !== share.accountId) {
        return null;
      }
      if (!FolderPathIsInSubtree(folder.folderpath, shareFolder.folderpath)) {
        return null;
      }
      return folder;
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
      // Only the folder's own name is exposed, never the ancestor paths.
      const folderName =
        resolved.shareFolder.folderpath.split("/").filter(Boolean).pop() ||
        "/";
      return res.status(200).send({
        folderName,
        dateExpires: resolved.share.dateExpires
          ? resolved.share.dateExpires.toISOString()
          : null,
      });
    });

    interface GetShareFoldersRequest extends RequestGenericInterface {
      Params: {
        token: string;
      };
    }
    fastify.get<GetShareFoldersRequest>("/:token/folders", async (req, res) => {
      const span = OTelRequestSpan(req);
      const resolved = await shareFor(span, req.params.token);
      if (!resolved) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      const accountFolders = await FolderDataListForAccount(
        span,
        resolved.share.accountId,
      );
      const folders = accountFolders
        .filter((folder) =>
          FolderPathIsInSubtree(
            folder.folderpath,
            resolved.shareFolder.folderpath,
          ),
        )
        .map((folder) => ({ id: folder.id, folderpath: folder.folderpath }));
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
        const resolved = await shareFor(span, req.params.token);
        if (!resolved) {
          return res.status(404).send({ error: "Share Not Found" });
        }
        const folder = await folderInSubtreeFor(
          span,
          resolved.share,
          resolved.shareFolder,
          req.params.folderId,
        );
        if (!folder) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const includeSubFolders = req.query.includeSubFolders === "true";
        const sortOrder: "asc" | "desc" =
          req.query.sortOrder === "asc" ? "asc" : "desc";
        const page = parseInt(req.query.page || "0", 10);
        const pageSize = parseInt(req.query.pageSize || "60", 10);
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
        return res.status(200).send({
          files: result.files,
          page,
          pageSize,
          total: result.total,
        });
      },
    );

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
        if (!file || file.accountId !== resolved.share.accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const folder = await folderInSubtreeFor(
          span,
          resolved.share,
          resolved.shareFolder,
          file.folderId,
        );
        if (!folder) {
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
  }
}
