export enum FileMediaType {
  image = "image",
  imageRaw = "imageRaw",
  video = "video",
  unknown = "unknown",
}

// One source of truth for media-type extension lists, shared by
// File.getMediaType() and the search media-type facet (SQL LIKE).
export const FILE_MEDIA_TYPE_EXTENSIONS: Record<
  FileMediaType,
  string[]
> = {
  [FileMediaType.image]: ["jpg", "jpeg", "png", "gif", "webp", "tiff"],
  [FileMediaType.imageRaw]: ["dng", "raw", "arw", "heic"],
  [FileMediaType.video]: [
    "mp4",
    "mov",
    "wmv",
    "avi",
    "mkv",
    "mpg",
    "mpeg",
    "flv",
  ],
  [FileMediaType.unknown]: [],
};
