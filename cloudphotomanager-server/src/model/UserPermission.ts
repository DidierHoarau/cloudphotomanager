import { v4 as uuidv4 } from "uuid";
import { UserPermissionInfo } from "./UserPermissionInfo";

export class UserPermission {
  //
  public id: string;
  public userId: string;
  public info: UserPermissionInfo;

  constructor() {
    this.id = uuidv4();
    this.info = {
      isAdmin: false,
      folders: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public toJson(): any {
    return {
      id: this.id,
      userId: this.userId,
      info: this.info,
    };
  }
}
