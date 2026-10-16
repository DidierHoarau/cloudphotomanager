import { v4 as uuidv4 } from "uuid";

export class ShareLink {
  //
  public id: string;
  public accountId: string;
  public folderId: string;
  public dateCreated: Date;
  public dateExpires: Date;
  public info: any;

  constructor(accountId: string, folderId: string) {
    this.id = uuidv4();
    this.accountId = accountId;
    this.folderId = folderId;
    this.dateCreated = new Date();
    this.dateExpires = null;
    this.info = {};
  }
}
