import { Span } from "@opentelemetry/sdk-trace-base";
import { FolderDataGet, FolderDataListForAccount } from "../folders/FolderData";
import { Folder } from "../model/Folder";
import { OTelTracer } from "../OTelContext";
import { UserPermissionDataGetForUser } from "./UserPermissionData";

export interface UserPermissionFolderRef {
  id: string;
  accountId: string;
  folderpath: string;
}

interface UserPermissionGrant {
  folderId: string;
  scope: string;
  accountId: string;
  folderpath: string;
}

export interface UserPermissionContext {
  userId: string;
  isAdmin: boolean;
  grants: UserPermissionGrant[];
}

// Loads the user's permissions once and resolves each granted folder
// definition (id + path) so subsequent checks do not hit the DB per folder.
export async function UserPermissionContextGet(
  context: Span,
  userId: string,
): Promise<UserPermissionContext> {
  const span = OTelTracer().startSpan("UserPermissionContext_get", context);
  try {
    const userPermissions = await UserPermissionDataGetForUser(span, userId);
    const result: UserPermissionContext = {
      userId,
      isAdmin: userPermissions?.info?.isAdmin === true,
      grants: [],
    };
    if (result.isAdmin) {
      return result;
    }
    for (const folderPermission of userPermissions.info.folders || []) {
      const folder = await FolderDataGet(span, folderPermission.folderId);
      if (folder) {
        result.grants.push({
          folderId: folder.id,
          scope: folderPermission.scope,
          accountId: folder.accountId,
          folderpath: folder.folderpath,
        });
      }
    }
    return result;
  } finally {
    span.end();
  }
}

export function UserPermissionContextFolderIsPermitted(
  permissionContext: UserPermissionContext,
  folder: UserPermissionFolderRef,
): boolean {
  if (permissionContext.isAdmin) {
    return true;
  }
  for (const grant of permissionContext.grants) {
    // Any scope grants access to the granted folder itself.
    if (grant.folderId === folder.id) {
      return true;
    }
    if (
      grant.scope === "ro_recursive" &&
      grant.accountId === folder.accountId &&
      FolderPathIsInSubtree(folder.folderpath, grant.folderpath)
    ) {
      return true;
    }
  }
  return false;
}

// Returns the ids of all folders of `accountId` the user may access, or
// `null` when no filtering is needed for that account (admin, or a recursive
// grant on the account root). The result is meant to be used with an
// account-scoped SQL query (folderId IN (SELECT value FROM json_each(?))).
export async function UserPermissionContextFolderIdsGet(
  context: Span,
  permissionContext: UserPermissionContext,
  accountId: string,
): Promise<string[] | null> {
  if (permissionContext.isAdmin) {
    return null;
  }
  const span = OTelTracer().startSpan(
    "UserPermissionContext_getFolderIds",
    context,
  );
  try {
    const accountGrants = permissionContext.grants.filter(
      (grant) => grant.accountId === accountId,
    );
    if (accountGrants.length === 0) {
      return [];
    }
    if (
      accountGrants.some(
        (grant) => grant.scope === "ro_recursive" && grant.folderpath === "/",
      )
    ) {
      return null;
    }
    const idSet = new Set<string>();
    for (const grant of accountGrants) {
      idSet.add(grant.folderId);
    }
    const recursiveGrants = accountGrants.filter(
      (grant) => grant.scope === "ro_recursive",
    );
    if (recursiveGrants.length > 0) {
      const folders = await FolderDataListForAccount(span, accountId);
      for (const folder of folders) {
        if (
          recursiveGrants.some((grant) =>
            FolderPathIsInSubtree(folder.folderpath, grant.folderpath),
          )
        ) {
          idSet.add(folder.id);
        }
      }
    }
    return Array.from(idSet);
  } finally {
    span.end();
  }
}

export async function UserPermissionCheckFolderForUser(
  context: Span,
  userId: string,
  folder: UserPermissionFolderRef,
): Promise<boolean> {
  const span = OTelTracer().startSpan(
    "UserPermissionCheck_folderForUser",
    context,
  );
  try {
    const permissionContext = await UserPermissionContextGet(span, userId);
    return UserPermissionContextFolderIsPermitted(permissionContext, folder);
  } finally {
    span.end();
  }
}

export async function UserPermissionCheckFilterFoldersForUser(
  context: Span,
  folders: Folder[],
  userId: string,
): Promise<Folder[]> {
  const span = OTelTracer().startSpan(
    "UserPermissionCheck_filterFoldersForUser",
    context,
  );
  try {
    const permissionContext = await UserPermissionContextGet(span, userId);
    if (permissionContext.isAdmin) {
      return folders;
    }
    return folders.filter((folder) =>
      UserPermissionContextFolderIsPermitted(permissionContext, {
        id: folder.id,
        accountId: folder.accountId,
        folderpath: folder.folderpath,
      }),
    );
  } finally {
    span.end();
  }
}

function FolderPathIsInSubtree(folderpath: string, ancestorPath: string): boolean {
  if (ancestorPath === "/") {
    return true;
  }
  return (
    folderpath === ancestorPath || folderpath.startsWith(`${ancestorPath}/`)
  );
}
