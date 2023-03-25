import { FileMediaType } from "./FileMediaType";
import * as md5 from "md5";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public metadata: any;

  constructor(accountId: string, folderId: string, filename: string) {
    this.id = md5(encodeURI(`${accountId}/${folderId}/${filename}`));
    this.accountId = accountId;
    this.folderId = folderId;
    this.filename = filename;
    this.info = {};
    this.metadata = {};
  }

  public static getMediaType(name: string): FileMediaType {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp"];
    const videoExtensions = ["mp4", "mov", "wmv", "avi", "mkv"];
    const extension = name.split(".").pop().toLowerCase();
    if (imageExtensions.includes(extension)) {
      return FileMediaType.image;
    } else if (videoExtensions.includes(extension)) {
      return FileMediaType.video;
    } else {
      return FileMediaType.unknown;
    }
  }
}
