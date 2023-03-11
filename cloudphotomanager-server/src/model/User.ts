import { v4 as uuidv4 } from "uuid";

export class User {
  //
  public id: string;
  public name: string;
  public passwordEncrypted: string;

  constructor() {
    this.id = uuidv4();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public toJson(): any {
    return {
      id: this.id,
      name: this.name,
      passwordEncrypted: this.passwordEncrypted,
    };
  }
}
