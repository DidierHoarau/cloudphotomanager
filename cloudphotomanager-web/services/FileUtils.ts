export class FileUtils {
  //
  public static getType(file: any) {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "heic", "dng"];
    const videoExtensions = ["mp4", "mov", "wmv", "avi", "mkv"];
    const extension = file.filename.split(".").pop().toLowerCase();
    if (imageExtensions.includes(extension)) {
      return "image";
    } else if (videoExtensions.includes(extension)) {
      return "video";
    } else {
      return "unknown";
    }
  }

  public static getExtention(file: any) {
    return file.filename.split(".").pop();
  }

  public static getWithoutExtention(file: any) {
    return file.filename.substring(0, file.filename.lastIndexOf("."));
  }
}
