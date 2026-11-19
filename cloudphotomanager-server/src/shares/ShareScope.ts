import { Span } from "@opentelemetry/sdk-trace";
import { AlbumDataGet, AlbumDataItemIsMember } from "../albums/AlbumData";
import { FileDataGet } from "../files/FileData";
import { FolderDataGet } from "../folders/FolderData";
import { Album } from "../model/Album";
import { File } from "../model/File";
import { Folder } from "../model/Folder";
import { ShareLink } from "../model/ShareLink";

// Single authorization helper shared by the public share routes and media so
// folder shares, album shares and single-file shares all apply the same
// rules: live target, account match, non-trashed files, folder subtree for
// folder shares and live album membership for album shares.

export function FolderPathIsInSubtree(
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

export interface ShareScopeResolved {
  kind: "folder" | "album" | "file";
  name: string;
  folder?: Folder;
  album?: Album;
  file?: File;
}

function folderDisplayName(folderpath: string): string {
  return folderpath.split("/").filter(Boolean).pop() || "/";
}

// Resolves the shared target; null when it was deleted (or belongs to another
// account) so callers answer 404 exactly like an unknown token.
export async function ShareScopeResolve(
  context: Span,
  share: ShareLink,
): Promise<ShareScopeResolved | null> {
  if (!share) {
    return null;
  }
  if (share.scope === "album") {
    const album = await AlbumDataGet(context, share.albumId);
    if (!album || album.accountId !== share.accountId) {
      return null;
    }
    return { kind: "album", name: album.name, album };
  }
  if (share.scope === "file") {
    const file = await FileDataGet(context, share.fileId);
    if (!file || file.accountId !== share.accountId || file.trashed) {
      return null;
    }
    return { kind: "file", name: file.filename, file };
  }
  const folder = await FolderDataGet(context, share.folderId);
  if (!folder || folder.accountId !== share.accountId) {
    return null;
  }
  return {
    kind: "folder",
    name: folderDisplayName(folder.folderpath),
    folder,
  };
}

// Checks a single file against the share scope. The caller has already
// authorized the share (token, expiry, revocation).
export async function ShareScopeCanAccessFile(
  context: Span,
  share: ShareLink,
  file: File,
): Promise<boolean> {
  if (!file || file.accountId !== share.accountId || file.trashed) {
    return false;
  }
  if (share.scope === "file") {
    return file.id === share.fileId;
  }
  if (share.scope === "album") {
    const album = await AlbumDataGet(context, share.albumId);
    if (!album || album.accountId !== share.accountId) {
      return false;
    }
    return AlbumDataItemIsMember(context, share.albumId, file.id);
  }
  const folder = await FolderDataGet(context, file.folderId);
  if (!folder || folder.accountId !== share.accountId) {
    return false;
  }
  return ShareScopeCanAccessFolder(context, share, folder);
}

export async function ShareScopeCanAccessFolder(
  context: Span,
  share: ShareLink,
  folder: Folder,
): Promise<boolean> {
  if (share.scope !== "folder") {
    return false;
  }
  if (!folder || folder.accountId !== share.accountId) {
    return false;
  }
  const shareFolder = await FolderDataGet(context, share.folderId);
  if (!shareFolder || shareFolder.accountId !== share.accountId) {
    return false;
  }
  return FolderPathIsInSubtree(folder.folderpath, shareFolder.folderpath);
}

// Base name for the archive served by a share: no path separators or control
// characters can leak into Content-Disposition.
export function ShareScopeArchiveName(
  share: ShareLink,
  resolved: ShareScopeResolved | null,
): string {
  let name = "";
  if (resolved?.kind === "album") {
    name = resolved.album.name;
  } else if (resolved?.kind === "file") {
    name = resolved.file.filename;
  }
  const cleaned = (name || "share")
    .replace(/[/\\]+/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, "-")
    .replace(/["<>|:*?]/g, "-")
    .trim()
    .substring(0, 100);
  return cleaned.length > 0 ? cleaned : "share";
}
