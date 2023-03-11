import { v4 as uuidv4 } from "uuid";

export class UserPermission {
  //
  public id: string;
  public userId: string;
  public isAdmin = false;

  constructor() {
    this.id = uuidv4();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public toJson(): any {
    return {
      id: this.id,
      userId: this.userId,
      info: { isAdmin: this.isAdmin },
    };
  }
}
