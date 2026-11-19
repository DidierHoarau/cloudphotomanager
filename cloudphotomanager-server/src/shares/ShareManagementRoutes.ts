import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { AlbumDataGet } from "../albums/AlbumData";
import { AccountDataGet } from "../accounts/AccountData";
import { FileDataGet } from "../files/FileData";
import { FolderDataGet } from "../folders/FolderData";
import { ShareLink, ShareScope } from "../model/ShareLink";
import { UserDataGet } from "../users/UserData";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import {
  ShareDataCreateForScope,
  ShareDataDelete,
  ShareDataGetById,
  ShareDataListActive,
  ShareDataPathFor,
} from "./ShareData";

const SHARE_SCOPES: ShareScope[] = ["folder", "album", "file"];

function ShareScopeName(scope: ShareScope): string {
  return scope;
}

async function TargetName(span: any, share: ShareLink): Promise<string | null> {
  if (share.scope === "folder") {
    const folder = await FolderDataGet(span, share.folderId);
    if (!folder) {
      return null;
    }
    return folder.folderpath.split("/").filter(Boolean).pop() || "/";
  }
  if (share.scope === "album") {
    const album = await AlbumDataGet(span, share.albumId);
    return album ? album.name : null;
  }
  const file = await FileDataGet(span, share.fileId);
  return file ? file.filename : null;
}

async function TargetBelongsToAccount(
  span: any,
  accountId: string,
  scope: ShareScope,
  scopeId: string,
): Promise<boolean> {
  if (scope === "folder") {
    const folder = await FolderDataGet(span, scopeId);
    return !!folder && folder.accountId === accountId;
  }
  if (scope === "album") {
    const album = await AlbumDataGet(span, scopeId);
    return !!album && album.accountId === accountId;
  }
  const file = await FileDataGet(span, scopeId);
  return !!file && file.accountId === accountId;
}

// Admin-only share overview and management across folders, albums and single
// files. Tokens are never stored in plaintext; derived shares expose a
// re-computable sharePath, legacy random-token shares are rotated to become
// copyable again.
export class ShareManagementRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface ListSharesRequest extends RequestGenericInterface {
      Querystring: {
        accountId?: string;
        scope?: string;
        scopeId?: string;
      };
    }
    fastify.get<ListSharesRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      let scope: ShareScope | undefined;
      if (req.query.scope !== undefined && req.query.scope !== "") {
        if (!SHARE_SCOPES.includes(req.query.scope as ShareScope)) {
          return res.status(400).send({ error: "Invalid parameter: scope" });
        }
        scope = req.query.scope as ShareScope;
      }
      const shares = await ShareDataListActive(span, {
        accountId: req.query.accountId || undefined,
        scope,
        scopeId: req.query.scopeId || undefined,
      });
      const ownerNames = new Map<string, string>();
      const result = [];
      for (const share of shares) {
        let ownerName: string | null = null;
        if (share.ownerUserId) {
          if (!ownerNames.has(share.ownerUserId)) {
            const owner = await UserDataGet(span, share.ownerUserId);
            ownerNames.set(share.ownerUserId, owner ? owner.name : null);
          }
          ownerName = ownerNames.get(share.ownerUserId);
        }
        const sharePath = ShareDataPathFor(share);
        result.push({
          id: share.id,
          accountId: share.accountId,
          scope: ShareScopeName(share.scope),
          scopeId: share.scopeId(),
          targetName: await TargetName(span, share),
          ownerUserId: share.ownerUserId,
          ownerName,
          dateCreated: share.dateCreated.toISOString(),
          dateExpires: share.dateExpires
            ? share.dateExpires.toISOString()
            : null,
          lastAccessDate: share.lastAccessDate
            ? share.lastAccessDate.toISOString()
            : null,
          legacy: sharePath === null,
          sharePath,
        });
      }
      return res.status(200).send({ shares: result });
    });

    interface CreateShareRequest extends RequestGenericInterface {
      Body: {
        accountId?: string;
        scope?: string;
        scopeId?: string;
        expiresInDays?: number;
      };
    }
    fastify.post<CreateShareRequest>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const { accountId, scope, scopeId } = req.body || {};
      if (!accountId || !scopeId) {
        return res
          .status(400)
          .send({ error: "Missing parameter: accountId or scopeId" });
      }
      if (!SHARE_SCOPES.includes(scope as ShareScope)) {
        return res.status(400).send({ error: "Invalid parameter: scope" });
      }
      try {
        await AccountDataGet(span, accountId);
      } catch {
        return res.status(404).send({ error: "Account Not Found" });
      }
      if (
        !(await TargetBelongsToAccount(
          span,
          accountId,
          scope as ShareScope,
          scopeId,
        ))
      ) {
        return res.status(404).send({ error: "Share Target Not Found" });
      }
      let expiresInDays: number = null;
      if (req.body.expiresInDays !== undefined) {
        expiresInDays = Number(req.body.expiresInDays);
        if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
          return res
            .status(400)
            .send({ error: "Invalid parameter: expiresInDays" });
        }
      }
      const created = await ShareDataCreateForScope(span, {
        accountId,
        scope: scope as ShareScope,
        scopeId,
        ownerUserId: userSession.userId,
        expiresInDays,
      });
      return res.status(201).send({
        shareId: created.share.id,
        sharePath: `/share?t=${encodeURIComponent(created.token)}`,
        dateExpires: created.share.dateExpires
          ? created.share.dateExpires.toISOString()
          : null,
      });
    });

    interface ShareIdRequest extends RequestGenericInterface {
      Params: { shareId: string };
    }
    fastify.delete<ShareIdRequest>("/:shareId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const share = await ShareDataGetById(span, req.params.shareId);
      if (!share) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      await ShareDataDelete(span, share.id);
      return res.status(202).send({});
    });

    // Rotates a legacy (or any active) share: a derived share with the same
    // scope and deadline replaces it, so the old link stops working and the
    // admin gets a copyable URL again.
    fastify.post<ShareIdRequest>("/:shareId/rotate", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const share = await ShareDataGetById(span, req.params.shareId);
      if (!share) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      if (share.dateExpires && share.dateExpires.getTime() <= Date.now()) {
        return res.status(404).send({ error: "Share Not Found" });
      }
      const scopeId = share.scopeId();
      if (
        !(await TargetBelongsToAccount(
          span,
          share.accountId,
          share.scope,
          scopeId,
        ))
      ) {
        return res.status(404).send({ error: "Share Target Not Found" });
      }
      const created = await ShareDataCreateForScope(span, {
        accountId: share.accountId,
        scope: share.scope,
        scopeId,
        ownerUserId: share.ownerUserId || userSession.userId,
        expiresAt: share.dateExpires,
      });
      await ShareDataDelete(span, share.id);
      return res.status(201).send({
        shareId: created.share.id,
        sharePath: `/share?t=${encodeURIComponent(created.token)}`,
        dateExpires: created.share.dateExpires
          ? created.share.dateExpires.toISOString()
          : null,
      });
    });
  }
}
