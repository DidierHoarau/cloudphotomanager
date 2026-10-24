import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance } from "fastify";
import * as fs from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { FolderDataGet } from "../folders/FolderData";
import { FileDataGet, FileDataGetFileCacheDir } from "../files/FileData";
import { File } from "../model/File";
import { ShareLink } from "../model/ShareLink";
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";
import { OTelLogger } from "../OTelContext";
import { ShareDataGet } from "../shares/ShareData";
import { SyncFileCacheCheckAsync } from "../sync/SyncFileCache";
import { AuthGetUserSession } from "../users/Auth";
import {
  UserPermissionContextFolderIsPermitted,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import {
  MediaAssetIsValid,
  MediaSignatureFields,
  MediaSigningVerify,
} from "./MediaSigning";

const logger = OTelLogger().createModuleLogger("MediaRoutes");

const ASSET_MIME_TYPES: Record<string, string> = {
  "thumbnail.webp": "image/webp",
  "preview.webp": "image/webp",
  "preview.mp4": "video/mp4",
};

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

// Serves the cache assets (thumbnails, previews, video previews) through
// short-lived signed URLs instead of the public /static tree. Every request
// re-checks the live session/permission or the live share, so revoking access
// or deleting a file stops serving its media immediately.
export class MediaRoutes {
  //
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.getRoutes = this.getRoutes.bind(this);
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
        fileId: string;
        asset: string;
      };
      Querystring: {
        exp?: string;
        sig?: string;
        s?: string;
      };
    }>("/:accountId/:fileId/:asset", async (req, res) => {
      const span = OTelRequestSpan(req);
      const { accountId, fileId, asset } = req.params;
      const now = Math.floor(Date.now() / 1000);

      if (!MediaAssetIsValid(asset)) {
        return res.status(404).send({ error: "Not Found" });
      }
      const exp = Number(req.query.exp);
      const signature = req.query.sig || "";
      if (!Number.isFinite(exp) || exp <= 0 || !signature) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (exp <= now) {
        return res.status(403).send({ error: "Access Denied" });
      }

      let file: File = null;
      if (req.query.s) {
        // Share subject: the token/share id is the credential, no session.
        const shareId = req.query.s;
        const fields: MediaSignatureFields = {
          kind: "share",
          accountId,
          fileId,
          asset,
          exp,
          subjectId: shareId,
          subjectVersion: 0,
        };
        if (!MediaSigningVerify(fields, signature)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const share: ShareLink = await ShareDataGet(span, shareId);
        if (!share) {
          return res.status(404).send({ error: "Share Not Found" });
        }
        if (share.accountId !== accountId) {
          return res.status(403).send({ error: "Access Denied" });
        }
        file = await FileDataGet(span, fileId);
        if (!file || file.accountId !== accountId || file.trashed) {
          return res.status(404).send({ error: "Not Found" });
        }
        const folder = await FolderDataGet(span, file.folderId);
        const shareFolder = await FolderDataGet(span, share.folderId);
        if (!folder || !shareFolder || folder.accountId !== accountId) {
          return res.status(404).send({ error: "Not Found" });
        }
        if (!FolderPathIsInSubtree(folder.folderpath, shareFolder.folderpath)) {
          return res.status(403).send({ error: "Access Denied" });
        }
      } else {
        // User subject: a live session plus live folder permission.
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const fields: MediaSignatureFields = {
          kind: "user",
          accountId,
          fileId,
          asset,
          exp,
          subjectId: userSession.userId,
          subjectVersion: userSession.tokenVersion ?? 0,
        };
        if (!MediaSigningVerify(fields, signature)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        file = await FileDataGet(span, fileId);
        if (!file || file.accountId !== accountId || file.trashed) {
          return res.status(404).send({ error: "Not Found" });
        }
        const folder = await FolderDataGet(span, file.folderId);
        if (!folder) {
          return res.status(404).send({ error: "Not Found" });
        }
        if (folder.accountId !== accountId) {
          return res.status(403).send({ error: "Access Denied" });
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
      }

      const cacheDir = await FileDataGetFileCacheDir(span, accountId, fileId);
      const assetPath = path.join(cacheDir, asset);
      if (!fs.existsSync(assetPath)) {
        // The listing advertised the asset but the cache has not produced it
        // yet: ask the sync queue for it (authorized subject only).
        SyncFileCacheCheckAsync(
          accountId,
          fileId,
          SyncQueueItemPriority.INTERACTIVE,
        ).catch((error) => {
          logger.error("Error queuing missing media cache", error);
        });
        return res.status(404).send({ error: "Not Found" });
      }

      const stats = await fs.stat(assetPath);
      const maxAge = Math.max(
        0,
        Math.min(this.config.MEDIA_CACHE_SECONDS, exp - now),
      );
      res.header("Content-Type", ASSET_MIME_TYPES[asset]);
      res.header("Content-Disposition", `inline; filename="${asset}"`);
      res.header("Cache-Control", `private, max-age=${maxAge}`);
      res.header("Vary", "Cookie, Authorization");
      res.header("X-Content-Type-Options", "nosniff");
      res.header("Accept-Ranges", "bytes");

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match || (!match[1] && !match[2])) {
          res.header("Content-Range", `bytes */${stats.size}`);
          return res.status(416).send();
        }
        let start: number;
        let end: number;
        if (!match[1]) {
          const suffixLength = parseInt(match[2], 10);
          start = Math.max(0, stats.size - suffixLength);
          end = stats.size - 1;
        } else {
          start = parseInt(match[1], 10);
          end = match[2]
            ? Math.min(parseInt(match[2], 10), stats.size - 1)
            : stats.size - 1;
        }
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start > end ||
          start >= stats.size
        ) {
          res.header("Content-Range", `bytes */${stats.size}`);
          return res.status(416).send();
        }
        res.status(206);
        res.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
        res.header("Content-Length", end - start + 1);
        return res.send(fs.createReadStream(assetPath, { start, end }));
      }

      res.header("Content-Length", stats.size);
      return res.send(fs.createReadStream(assetPath));
    });
  }
}
