import { UtilsMd5 } from "../Utils";

export class Folder {
  //
  public id: string;
  public idCloud?: string;
  public folderpath: string;
  public childrenCount: string;
  public accountId: string;
  public dateSync: Date;
  public dateUpdated: Date;
  public info: any;

  constructor(accountId: string, folderpath: string) {
    this.id = UtilsMd5(encodeURI(`${accountId}/${folderpath}`));
    this.accountId = accountId;
    this.folderpath = folderpath;
    this.info = {};
  }
}
