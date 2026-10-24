import Config from "./Config";

// Media assets are served through short-lived signed URLs minted by the API
// (file.thumbnailUrl / file.previewUrl / file.videoPreviewUrl). Files without
// URLs (e.g. sync-failure panels) fall back to the authenticated legacy
// endpoints.
export class MediaUrls {
  //
  public static thumbnail(file: any): string {
    if (!file) return "";
    if (file.thumbnailUrl) return file.thumbnailUrl;
    return `${Config.sync.SERVER_URL}/files/${encodeURIComponent(file.id)}/thumbnail`;
  }

  public static imagePreview(file: any): string {
    if (!file) return "";
    if (file.previewUrl) return file.previewUrl;
    return `${Config.sync.SERVER_URL}/files/${encodeURIComponent(file.id)}/preview`;
  }

  public static videoPreview(file: any): string {
    if (!file) return "";
    return file.videoPreviewUrl || "";
  }
}
