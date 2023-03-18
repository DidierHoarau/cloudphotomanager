import { v4 as uuidv4 } from "uuid";

export class Folder {
  //
  public id: string;
  public idCloud?: string;
  public folderpath: string;
  public childrenCount: string;
  public accountId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info: any;

  constructor() {
    this.id = uuidv4();
    this.info = {};
  }
}
