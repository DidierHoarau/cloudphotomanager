import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { AccountDataGet } from "../accounts/AccountData";
import { Album, ALBUM_MAX_ITEMS } from "../model/Album";
import { File } from "../model/File";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { UserSession } from "../model/UserSession";
import { FileDataGet } from "../files/FileData";
import { FolderDataGet } from "../folders/FolderData";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import { PaginationParse } from "../utils-std-ts/Pagination";
import {
  AlbumDataCoverFile,
  AlbumDataCreate,
  AlbumDataDelete,
  AlbumDataGet,
  AlbumDataItemCount,
  AlbumDataItemIsMember,
  AlbumDataItemsAdd,
  AlbumDataItemsListPaginated,
  AlbumDataItemsMove,
  AlbumDataItemsRemove,
  AlbumDataListForAccount,
  AlbumDataNewItemCount,
  AlbumDataSetOrderModeManual,
  AlbumDataStats,
  AlbumDataUpdate,
  AlbumListEntry,
} from "./AlbumData";

const MAX_ITEMS_PER_REQUEST = 500;

function AlbumNameValidate(name: unknown): string | null {
  if (typeof name !== "string") {
    return "Invalid parameter: name";
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return "Invalid parameter: name";
  }
  return null;
}

function AlbumFileIdListValidate(fileIds: unknown): string[] | null {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return null;
  }
  if (fileIds.length > MAX_ITEMS_PER_REQUEST) {
    return null;
  }
  if (fileIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return null;
  }
  return fileIds as string[];
}

async function PermittedFolderIdsFor(
  span: any,
  userSession: UserSession,
  accountId: string,
): Promise<string[] | null> {
  const permissionContext = await UserPermissionContextGet(
    span,
    userSession.userId,
  );
  return UserPermissionContextFolderIdsGet(
    span,
    permissionContext,
    accountId,
  );
}

async function AlbumVisibleFor(
  span: any,
  userSession: UserSession,
  album: Album,
  permittedFolderIds: string[] | null,
): Promise<boolean> {
  if (AuthIsAdmin(userSession)) {
    return true;
  }
  if (album.ownerUserId === userSession.userId) {
    return true;
  }
  const stats = await AlbumDataStats(
    span,
    album.id,
    album.accountId,
    permittedFolderIds,
  );
  return stats.count > 0;
}

function AlbumCanEdit(userSession: UserSession, album: Album): boolean {
  return AuthIsAdmin(userSession) || album.ownerUserId === userSession.userId;
}

function AlbumToJson(
  album: Album,
  itemCount: number,
  cover: File | null,
  userSession: UserSession,
): any {
  if (cover) {
    MediaUrlsAttachForUser([cover], userSession);
  }
  return {
    id: album.id,
    accountId: album.accountId,
    name: album.name,
    coverFileId: album.coverFileId,
    cover,
    orderMode: album.orderMode,
    ownerUserId: album.ownerUserId,
    itemCount,
    canEdit: AlbumCanEdit(userSession, album),
    dateCreated: album.dateCreated.toISOString(),
    dateUpdated: album.dateUpdated.toISOString(),
  };
}

// Albums: cross-folder ordered sets of files. Reads are folder-grant filtered;
// mutations require the album owner or an admin.
export class AlbumRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface ListAlbumsRequest extends RequestGenericInterface {
      Params: { accountId: string };
    }
    fastify.get<ListAlbumsRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      const entries = await AlbumDataListForAccount(
        span,
        req.params.accountId,
        userSession.userId,
        AuthIsAdmin(userSession),
        permittedFolderIds,
      );
      return res.status(200).send({
        albums: entries.map((entry: AlbumListEntry) =>
          AlbumToJson(
            entry.album,
            entry.itemCount,
            entry.coverFile,
            userSession,
          ),
        ),
      });
    });

    interface CreateAlbumRequest extends RequestGenericInterface {
      Params: { accountId: string };
      Body: { name?: string };
    }
    fastify.post<CreateAlbumRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const nameError = AlbumNameValidate(req.body?.name);
      if (nameError) {
        return res.status(400).send({ error: nameError });
      }
      try {
        await AccountDataGet(span, req.params.accountId);
      } catch {
        return res.status(404).send({ error: "Account Not Found" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      if (
        !AuthIsAdmin(userSession) &&
        permittedFolderIds !== null &&
        permittedFolderIds.length === 0
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const album = new Album(
        req.params.accountId,
        (req.body.name as string).trim(),
        userSession.userId,
      );
      await AlbumDataCreate(span, album);
      return res
        .status(201)
        .send(AlbumToJson(album, 0, null, userSession));
    });

    interface AlbumRequest extends RequestGenericInterface {
      Params: { accountId: string; albumId: string };
    }
    fastify.get<AlbumRequest>("/:albumId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const album = await AlbumDataGet(span, req.params.albumId);
      if (!album || album.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      if (
        !(await AlbumVisibleFor(span, userSession, album, permittedFolderIds))
      ) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const stats = await AlbumDataStats(
        span,
        album.id,
        album.accountId,
        permittedFolderIds,
      );
      const cover = await AlbumDataCoverFile(
        span,
        album,
        permittedFolderIds,
      );
      return res
        .status(200)
        .send(AlbumToJson(album, stats.count, cover, userSession));
    });

    interface UpdateAlbumRequest extends AlbumRequest {
      Body: { name?: string; coverFileId?: string | null; orderMode?: string };
    }
    fastify.patch<UpdateAlbumRequest>("/:albumId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const album = await AlbumDataGet(span, req.params.albumId);
      if (!album || album.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      if (
        !(await AlbumVisibleFor(span, userSession, album, permittedFolderIds))
      ) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      if (!AlbumCanEdit(userSession, album)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (req.body?.name !== undefined) {
        const nameError = AlbumNameValidate(req.body.name);
        if (nameError) {
          return res.status(400).send({ error: nameError });
        }
        album.name = (req.body.name as string).trim();
      }
      if (req.body?.coverFileId !== undefined) {
        if (req.body.coverFileId === null) {
          album.coverFileId = null;
        } else {
          // The cover must be a member the editor may see.
          const isMember = await AlbumDataItemIsMember(
            span,
            album.id,
            req.body.coverFileId,
          );
          const file = isMember
            ? await FileDataGet(span, req.body.coverFileId)
            : null;
          const permitted =
            file &&
            file.accountId === album.accountId &&
            !file.trashed &&
            (await AlbumFilePermitted(
              span,
              album,
              file,
              userSession,
              permittedFolderIds,
            ));
          if (!permitted) {
            return res
              .status(400)
              .send({ error: "Invalid parameter: coverFileId" });
          }
          album.coverFileId = req.body.coverFileId;
        }
      }
      if (req.body?.orderMode !== undefined) {
        if (
          req.body.orderMode !== "capture" &&
          req.body.orderMode !== "manual"
        ) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: orderMode" });
        }
        if (req.body.orderMode === "manual" && album.orderMode !== "manual") {
          await AlbumDataSetOrderModeManual(span, album.id);
          album.orderMode = "manual";
        } else {
          album.orderMode = req.body.orderMode;
        }
      }
      await AlbumDataUpdate(span, album);
      const stats = await AlbumDataStats(
        span,
        album.id,
        album.accountId,
        permittedFolderIds,
      );
      const cover = await AlbumDataCoverFile(span, album, permittedFolderIds);
      return res
        .status(200)
        .send(AlbumToJson(album, stats.count, cover, userSession));
    });

    fastify.delete<AlbumRequest>("/:albumId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const album = await AlbumDataGet(span, req.params.albumId);
      if (!album || album.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      if (!AlbumCanEdit(userSession, album)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      await AlbumDataDelete(span, album.id);
      return res.status(202).send({});
    });

    interface AlbumItemsRequest extends AlbumRequest {
      Querystring: { page?: string; pageSize?: string; sortOrder?: string };
    }
    fastify.get<AlbumItemsRequest>("/:albumId/items", async (req, res) => {
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
      const album = await AlbumDataGet(span, req.params.albumId);
      if (!album || album.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      if (
        !(await AlbumVisibleFor(span, userSession, album, permittedFolderIds))
      ) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const sortOrder: "asc" | "desc" =
        req.query.sortOrder === "asc" ? "asc" : "desc";
      const result = await AlbumDataItemsListPaginated(
        span,
        album.id,
        album.accountId,
        album.orderMode,
        sortOrder,
        pagination.page,
        pagination.pageSize,
        permittedFolderIds,
      );
      MediaUrlsAttachForUser(result.files, userSession);
      return res.status(200).send({
        files: result.files,
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: result.total,
        orderMode: album.orderMode,
      });
    });

    interface AlbumItemsChangeRequest extends AlbumRequest {
      Body: { fileIds?: string[] };
    }
    fastify.post<AlbumItemsChangeRequest>("/:albumId/items", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const fileIds = AlbumFileIdListValidate(req.body?.fileIds);
      if (!fileIds) {
        return res
          .status(400)
          .send({ error: "Invalid parameter: fileIds (1 to 500 required)" });
      }
      const album = await AlbumDataGet(span, req.params.albumId);
      if (!album || album.accountId !== req.params.accountId) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      const permittedFolderIds = await PermittedFolderIdsFor(
        span,
        userSession,
        req.params.accountId,
      );
      if (
        !(await AlbumVisibleFor(span, userSession, album, permittedFolderIds))
      ) {
        return res.status(404).send({ error: "Album Not Found" });
      }
      if (!AlbumCanEdit(userSession, album)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      // All-or-nothing: every id must be a live file of this account that the
      // editor may see.
      for (const fileId of fileIds) {
        const file = await FileDataGet(span, fileId);
        const permitted =
          file &&
          file.accountId === album.accountId &&
          !file.trashed &&
          (await AlbumFilePermitted(
            span,
            album,
            file,
            userSession,
            permittedFolderIds,
          ));
        if (!permitted) {
          return res.status(403).send({ error: "Access Denied" });
        }
      }
      const currentCount = await AlbumDataItemCount(span, album.id);
      const newCount = await AlbumDataNewItemCount(span, album.id, fileIds);
      if (currentCount + newCount > ALBUM_MAX_ITEMS) {
        return res.status(400).send({
          error: `Album is full (max ${ALBUM_MAX_ITEMS} items)`,
        });
      }
      const added = await AlbumDataItemsAdd(span, album.id, fileIds);
      return res.status(200).send({ added });
    });

    fastify.delete<AlbumItemsChangeRequest>(
      "/:albumId/items",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const fileIds = AlbumFileIdListValidate(req.body?.fileIds);
        if (!fileIds) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: fileIds (1 to 500 required)" });
        }
        const album = await AlbumDataGet(span, req.params.albumId);
        if (!album || album.accountId !== req.params.accountId) {
          return res.status(404).send({ error: "Album Not Found" });
        }
        if (!AlbumCanEdit(userSession, album)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const removed = await AlbumDataItemsRemove(span, album.id, fileIds);
        return res.status(200).send({ removed });
      },
    );

    interface AlbumItemMoveRequest extends RequestGenericInterface {
      Params: { accountId: string; albumId: string; fileId: string };
      Body: { direction?: string };
    }
    fastify.post<AlbumItemMoveRequest>(
      "/:albumId/items/:fileId/move",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const direction = req.body?.direction;
        if (direction !== "earlier" && direction !== "later") {
          return res
            .status(400)
            .send({ error: "Invalid parameter: direction" });
        }
        const album = await AlbumDataGet(span, req.params.albumId);
        if (!album || album.accountId !== req.params.accountId) {
          return res.status(404).send({ error: "Album Not Found" });
        }
        if (!AlbumCanEdit(userSession, album)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const permittedFolderIds = await PermittedFolderIdsFor(
          span,
          userSession,
          req.params.accountId,
        );
        const moved = await AlbumDataItemsMove(
          span,
          album.id,
          album.accountId,
          album.orderMode,
          req.params.fileId,
          direction,
          permittedFolderIds,
        );
        if (!moved) {
          return res
            .status(400)
            .send({ error: "Item cannot be moved" });
        }
        return res.status(200).send({ orderMode: "manual" });
      },
    );
  }
}

async function AlbumFilePermitted(
  span: any,
  album: Album,
  file: File,
  userSession: UserSession,
  permittedFolderIds: string[] | null,
): Promise<boolean> {
  if (AuthIsAdmin(userSession)) {
    return true;
  }
  if (permittedFolderIds === null) {
    return true;
  }
  const folder = await FolderDataGet(span, file.folderId);
  if (!folder || folder.accountId !== album.accountId) {
    return false;
  }
  const permissionContext = await UserPermissionContextGet(
    span,
    userSession.userId,
  );
  return UserPermissionContextFolderIsPermitted(permissionContext, {
    id: folder.id,
    accountId: folder.accountId,
    folderpath: folder.folderpath,
  });
}
