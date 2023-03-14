import { FileMediaType } from "./FileMediaType";
import { v4 as uuidv4 } from "uuid";

export class File {
  //
  public id: string;
  public idCloud: string;
  public name: string;
  public filepath: string;
  public accountId: string;
  public dateModified: Date;
  public hash: string;

  // id VARCHAR(50) NOT NULL,
  // idCloud VARCHAR(50) NOT NULL,
  // accountId VARCHAR(50) NOT NULL,
  // folderpath TEXT NOT NULL,
  // filename TEXT NOT NULL,
  // info TEXT NOT NULL

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info: any;

  constructor() {
    this.id = uuidv4();
    this.info = {};
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
