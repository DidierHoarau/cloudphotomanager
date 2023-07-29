import { UserPermissionFolder } from "./UserPermissionFolder";

export interface UserPermissionInfo {
  //
  isAdmin: boolean;
  folders: UserPermissionFolder[];
}
