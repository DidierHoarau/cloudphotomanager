import { UtilsMd5 } from "../Utils";
import { FILE_MEDIA_TYPE_EXTENSIONS, FileMediaType } from "./FileMediaType";

export class File {
  //
  public id: string;
  public idCloud: string;
  public filename: string;
  public folderId: string;
  public accountId: string;
  public dateSync: Date;
  public dateUpdated: Date;
  public dateMedia: Date;
  public hash: string;
  public keywords: string;

  // Consecutive thumbnail/preview sync failures (reset on success or manual retry)
  public syncFailCount: number;
  public lastSyncError: string;
  public lastSyncAttempt: Date;

  // Tombstone for files that the cloud account reports as missing (404 /
  // ItemNotFound): they are not retried until a folder sync finds them again.
  public syncGone: number;

  // Curation state: favorite flag and soft-delete (trash) marker. Trashed
  // files stay in the cloud and in the DB until the retention purge.
  public favorite: number;
  public trashed: number;
  public dateTrashed: Date;

  public info: any;
  public metadata: any;

  constructor(accountId: string, folderId: string, filename: string) {
    this.id = UtilsMd5(encodeURI(`${accountId}/${folderId}/${filename}`));
    this.accountId = accountId;
    this.folderId = folderId;
    this.filename = filename;
    this.info = {};
    this.metadata = {};
    this.syncFailCount = 0;
    this.lastSyncError = null;
    this.lastSyncAttempt = null;
    this.syncGone = 0;
    this.favorite = 0;
    this.trashed = 0;
    this.dateTrashed = null;
  }

  public static getMediaType(name: string): FileMediaType {
    const extension = name.split(".").pop().toLowerCase();
    if (FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.image].includes(extension)) {
      return FileMediaType.image;
    } else if (
      FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.video].includes(extension)
    ) {
      return FileMediaType.video;
    } else if (
      FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.imageRaw].includes(extension)
    ) {
      return FileMediaType.imageRaw;
    } else {
      return FileMediaType.unknown;
    }
  }
}
