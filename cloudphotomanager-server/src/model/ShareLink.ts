import { v4 as uuidv4 } from "uuid";

export type ShareScope = "folder" | "album" | "file";
export type ShareTokenMode = "random" | "derived";

export class ShareLink {
  //
  public id: string;
  public accountId: string;
  public scope: ShareScope;
  public folderId: string;
  public albumId: string;
  public fileId: string;
  public dateCreated: Date;
  public dateExpires: Date;
  public lastAccessDate: Date;
  public ownerUserId: string;
  public tokenMode: ShareTokenMode;
  public info: any;

  constructor(accountId: string, folderId: string) {
    this.id = uuidv4();
    this.accountId = accountId;
    this.scope = "folder";
    this.folderId = folderId;
    this.albumId = null;
    this.fileId = null;
    this.dateCreated = new Date();
    this.dateExpires = null;
    this.lastAccessDate = null;
    this.ownerUserId = null;
    this.tokenMode = "random";
    this.info = {};
  }

  // The id of the shared target according to the scope (null when unset).
  public scopeId(): string {
    if (this.scope === "album") {
      return this.albumId;
    }
    if (this.scope === "file") {
      return this.fileId;
    }
    return this.folderId;
  }
}
