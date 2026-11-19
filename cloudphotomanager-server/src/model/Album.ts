import { v4 as uuidv4 } from "uuid";

export const ALBUM_NAME_MAX_LENGTH = 200;
export const ALBUM_MAX_ITEMS = 10000;

// An album is a cross-folder ordered set of file ids. Files stay in their
// folders; the album only references them.
export class Album {
  //
  public id: string;
  public accountId: string;
  public name: string;
  public coverFileId: string;
  public orderMode: "capture" | "manual";
  public ownerUserId: string;
  public dateCreated: Date;
  public dateUpdated: Date;
  public info: any;

  constructor(accountId: string, name: string, ownerUserId?: string) {
    this.id = uuidv4();
    this.accountId = accountId;
    this.name = name;
    this.coverFileId = null;
    this.orderMode = "capture";
    this.ownerUserId = ownerUserId ?? null;
    this.dateCreated = new Date();
    this.dateUpdated = new Date();
    this.info = {};
  }
}
