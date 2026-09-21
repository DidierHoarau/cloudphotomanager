import { v4 as uuidv4 } from "uuid";

export class AccountDefinition {
  //
  public id: string;
  public name: string;
  public rootpath: string;
  public info: any;
  public infoPrivate: any;

  constructor() {
    this.id = uuidv4();
  }
}
