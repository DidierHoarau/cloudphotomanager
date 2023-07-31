import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { UserPermissionData } from "./UserPermissionData";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Folder } from "../model/Folder";
import * as _ from "lodash";
import { FolderData } from "../folders/FolderData";

export class UserPermissionCheck {
  //
  public static async filterFoldersForUser(context: Span, folders: Folder[], userId: string): Promise<Folder[]> {
    const span = StandardTracer.startSpan("UserPermissionData_filterFoldersForUser", context);
    const filteredFolders = [];
    const userPermissions = await UserPermissionData.getForUser(span, userId);
    if (userPermissions.info.isAdmin) {
      return folders;
    }
    const folderPermittedList: Folder[] = [];

    for (const folderPermittedIteration of userPermissions.info.folders) {
      const folderPermittedDefinition = await FolderData.get(span, folderPermittedIteration.folderId);
      if (folderPermittedDefinition) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (folderPermittedDefinition as any).scope = folderPermittedIteration.scope;
        folderPermittedList.push(folderPermittedDefinition);
      }
    }

    for (const folder of folders) {
      for (const folderPermitted of folderPermittedList) {
        if (folderPermitted.id === folder.id) {
          filteredFolders.push(folder);
        } else if (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (folderPermitted as any).scope === "ro_recursive" &&
          folderPermitted.accountId === folder.accountId &&
          folder.folderpath.lastIndexOf(`${folderPermitted.folderpath}/`) === 0
        ) {
          filteredFolders.push(folder);
        }
      }
    }
    span.end();
    return filteredFolders;
  }
}
