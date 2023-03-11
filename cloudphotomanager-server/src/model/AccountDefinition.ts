import { v4 as uuidv4 } from "uuid";

export class AccountDefinition {
  //
  public id: string;
  public name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public infoPrivate: any;

  constructor() {
    this.id = uuidv4();
  }
}
