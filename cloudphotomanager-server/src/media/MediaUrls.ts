import { File } from "../model/File";
import { FileMediaType } from "../model/FileMediaType";
import { ShareLink } from "../model/ShareLink";
import { UserSession } from "../model/UserSession";
import { MediaSigningExp, MediaSigningUrl } from "./MediaSigning";

function attachForSubject(
  files: File[],
  fields: {
    kind: "user" | "share";
    subjectId: string;
    subjectVersion: number;
  },
): void {
  const exp = MediaSigningExp();
  for (const file of files || []) {
    if (!file) {
      continue;
    }
    const base = {
      kind: fields.kind,
      accountId: file.accountId,
      fileId: file.id,
      exp,
      subjectId: fields.subjectId,
      subjectVersion: fields.subjectVersion,
    };
    file.thumbnailUrl = MediaSigningUrl({ ...base, asset: "thumbnail.webp" });
    const mediaType = File.getMediaType(file.filename);
    if (mediaType === FileMediaType.image || mediaType === FileMediaType.imageRaw) {
      file.previewUrl = MediaSigningUrl({ ...base, asset: "preview.webp" });
    }
    if (mediaType === FileMediaType.video) {
      file.videoPreviewUrl = MediaSigningUrl({ ...base, asset: "preview.mp4" });
    }
  }
}

// Attaches the signed URLs for the authenticated user's live session; the
// signature is bound to the token version so a revocation invalidates them.
export function MediaUrlsAttachForUser(
  files: File[],
  userSession: UserSession,
): void {
  if (!userSession?.userId) {
    return;
  }
  attachForSubject(files, {
    kind: "user",
    subjectId: userSession.userId,
    subjectVersion: userSession.tokenVersion ?? 0,
  });
}

export function MediaUrlsAttachForShare(files: File[], share: ShareLink): void {
  if (!share?.id) {
    return;
  }
  attachForSubject(files, {
    kind: "share",
    subjectId: share.id,
    subjectVersion: 0,
  });
}
