import { v4 as uuidv4 } from "uuid";

export class User {
  //
  public id: string;
  public name: string;
  public passwordEncrypted: string;
  // Incremented whenever all of the user's sessions must be revoked.
  public tokenVersion: number;

  constructor() {
    this.id = uuidv4();
    this.tokenVersion = 0;
  }

  public toJson(): any {
    return {
      id: this.id,
      name: this.name,
      passwordEncrypted: this.passwordEncrypted,
      tokenVersion: this.tokenVersion,
    };
  }
}
