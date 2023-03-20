import { FileMediaType } from "./FileMediaType";
import { v4 as uuidv4 } from "uuid";

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

  constructor() {
    this.id = uuidv4();
    this.info = {};
    this.metadata = {};
  }

  public static getMediaType(name: string): FileMediaType {
    const imageExtensions = ["jpg", "jpeg", "png", "gif"];
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
