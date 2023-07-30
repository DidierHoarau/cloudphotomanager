import * as path from "path";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { UserPermissionData } from "./UserPermissionData";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Folder } from "../model/Folder";
import * as _ from "lodash";
import { FolderData } from "../folders/FolderData";

const logger = new Logger(path.basename(__filename));
let config: Config;

export class UserPermissionCheck {
  //
  public static async filterFoldersForUser(context: Span, folders: Folder[], userId: string): Promise<Folder[]> {
    const span = StandardTracer.startSpan("UserPermissionData_filterFoldersForUser", context);
    const filteredFolders = [];
    const userPermissions = await UserPermissionData.getForUser(span, userId);
    if (userPermissions.info.isAdmin) {
      return folders;
    }
    const folderPermissions = [];
    const includeSubfolders = async (folder: Folder) => {
      const subfolders = await FolderData.listSubFolders(span, folder);
      for (const subfolder of subfolders) {
        folderPermissions.push(subfolder);
        await includeSubfolders(subfolder);
      }
    };
    for (const folderPermitted of userPermissions.info.folders) {
      const baseFolderPermitted = await FolderData.get(span, folderPermitted.folderId);
      folderPermissions.push(baseFolderPermitted);
      if (folderPermitted.scope === "ro_recursive") {
        await includeSubfolders(baseFolderPermitted);
      }
    }
    for (const folderPermitted of folderPermissions) {
      const knownFolder = _.find(folders, { id: folderPermitted.id });
      if (knownFolder) {
        filteredFolders.push(knownFolder);
      }
    }
    span.end();
    return filteredFolders;
  }
}
