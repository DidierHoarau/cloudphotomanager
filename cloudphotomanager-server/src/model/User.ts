import { v4 as uuidv4 } from "uuid";

export class User {
  //
  public id: string;
  public name: string;
  public passwordEncrypted: string;
   

  constructor() {
    this.id = uuidv4();
  }

  public toJson(): any {
    return {
      id: this.id,
      name: this.name,
      passwordEncrypted: this.passwordEncrypted,
    };
  }
}
