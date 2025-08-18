import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Folder } from "../model/Folder";
import { FolderDataGet } from "../folders/FolderData";
import { UserPermissionDataGetForUser } from "./UserPermissionData";

export async function UserPermissionCheckFilterFoldersForUser(
  context: Span,
  folders: Folder[],
  userId: string
): Promise<Folder[]> {
  const span = StandardTracerStartSpan(
    "UserPermissionData_filterFoldersForUser",
    context
  );
  const filteredFolders = [];
  const userPermissions = await UserPermissionDataGetForUser(span, userId);
  if (userPermissions.info.isAdmin) {
    return folders;
  }
  const folderPermittedList: Folder[] = [];

  for (const folderPermittedIteration of userPermissions.info.folders) {
    const folderPermittedDefinition = await FolderDataGet(
      span,
      folderPermittedIteration.folderId
    );
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
