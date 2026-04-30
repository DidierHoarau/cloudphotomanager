import Config from "./Config";

let cachedStaticUrl: string | null = null;

async function getStaticUrl(): Promise<string> {
  if (cachedStaticUrl === null) {
    cachedStaticUrl = (await Config.get()).STATIC_URL;
  }
  return cachedStaticUrl as string;
}

function buildPath(staticUrl: string, file: any, assetName: string): string {
  return `${staticUrl}/${file.accountId}/${file.id[0]}/${file.id[1]}/${file.id}/${assetName}`;
}

export class MediaUrls {
  //
  public static async thumbnail(file: any): Promise<string> {
    if (!file) return "";
    return buildPath(await getStaticUrl(), file, "thumbnail.webp");
  }

  public static async imagePreview(file: any): Promise<string> {
    if (!file) return "";
    return buildPath(await getStaticUrl(), file, "preview.webp");
  }

  public static async videoPreview(file: any): Promise<string> {
    if (!file) return "";
    return buildPath(await getStaticUrl(), file, "preview.mp4");
  }

  public static thumbnailFromBase(staticUrl: string, file: any): string {
    if (!file || !staticUrl) return "";
    return buildPath(staticUrl, file, "thumbnail.webp");
  }

  public static imagePreviewFromBase(staticUrl: string, file: any): string {
    if (!file || !staticUrl) return "";
    return buildPath(staticUrl, file, "preview.webp");
  }

  public static videoPreviewFromBase(staticUrl: string, file: any): string {
    if (!file || !staticUrl) return "";
    return buildPath(staticUrl, file, "preview.mp4");
  }
}
