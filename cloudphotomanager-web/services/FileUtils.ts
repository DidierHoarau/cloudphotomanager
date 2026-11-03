// Fallback classification mirroring the server FILE_MEDIA_TYPE_EXTENSIONS
// (cloudphotomanager-server/src/model/FileMediaType.ts). The server sends the
// authoritative `mediaType` on every listed file; this map only covers local
// or synthetic objects. tests/fileUtils.spec.ts checks both stay in sync.
const MEDIA_TYPE_EXTENSIONS = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "tiff"],
  imageRaw: ["dng", "raw", "arw", "heic"],
  video: ["mp4", "mov", "wmv", "avi", "mkv", "mpg", "mpeg", "flv"],
};

export class FileUtils {
  //
  public static getType(file: any) {
    if (file.mediaType) {
      return file.mediaType;
    }
    const extension = file.filename.split(".").pop().toLowerCase();
    if (MEDIA_TYPE_EXTENSIONS.image.includes(extension)) {
      return "image";
    } else if (MEDIA_TYPE_EXTENSIONS.video.includes(extension)) {
      return "video";
    } else if (MEDIA_TYPE_EXTENSIONS.imageRaw.includes(extension)) {
      return "imageRaw";
    } else {
      return "unknown";
    }
  }

  public static isImage(file: any) {
    const type = this.getType(file);
    return type === "image" || type === "imageRaw";
  }

  public static getExtention(file: any) {
    return file.filename.split(".").pop();
  }

  public static getWithoutExtention(file: any) {
    return file.filename.substring(0, file.filename.lastIndexOf("."));
  }
}
