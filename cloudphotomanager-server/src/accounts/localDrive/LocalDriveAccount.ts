import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { AccountCapabilities } from "../../model/AccountCapabilities";
import {
  LocalAccountInventoryGetFolder,
  LocalAccountInventoryGetFolderByPath,
  LocalAccountInventoryListFilesInFolder,
  LocalAccountInventoryListFoldersInFolder,
} from "./LocalDriveAccountInventory";
import { pathExistsSync, stat } from "fs-extra";
import * as fs from "fs-extra";
import * as path from "path";

export class LocalAccount implements Account {
  //
  public static TYPE = "localDrive";

  private accountDefinition: AccountDefinition;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }
  getCapabilities(): AccountCapabilities {
    return {
      downloadPhotoThumbnail: false,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: false,
      downloadVideoPreview: false,
    };
  }
  async deleteFile(context: Span, file: File): Promise<void> {
    await fs.remove(file.idCloud);
  }
  async listFoldersInFolder(context: Span, folder: Folder): Promise<Folder[]> {
    return LocalAccountInventoryListFoldersInFolder(context, this, folder);
  }
  async getFolder(context: Span, folder: Folder): Promise<Folder> {
    return LocalAccountInventoryGetFolder(context, this, folder);
  }
  async getFolderByPath(context: Span, folderpath: string): Promise<Folder> {
    return LocalAccountInventoryGetFolderByPath(context, this, folderpath);
  }
  async moveFile(context: Span, file: File, folderpathDestination: string): Promise<void> {
    await fs.move(file.idCloud, path.join(this.accountDefinition.rootpath, folderpathDestination, file.filename));
  }
  listFolders(context: Span): Promise<Folder[]> {
    throw new Error("Method not implemented.");
  }
  async listFilesInFolder(context: Span, folder: Folder): Promise<File[]> {
    return LocalAccountInventoryListFilesInFolder(context, this, folder);
  }
  updateFileMetadata(context: Span, file: File): Promise<void> {
    throw new Error("Method not implemented.");
  }
  downloadPreview(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  downloadThumbnail(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string
  ): Promise<void> {
    await fs.copyFile(file.idCloud, path.join(destinationFolderpath, destinationFilename));
  }

  public async validate(context: Span): Promise<boolean> {
    const span = StandardTracerStartSpan("LocalAccount_validate", context);
    let valid = false;
    try {
      if (!pathExistsSync(this.accountDefinition.rootpath)) {
        throw new Error("Root path not found");
      }
      if (!(await stat(this.accountDefinition.rootpath)).isDirectory()) {
        throw new Error("Root path not a directory");
      }
      valid = true;
    } catch (err) {
      span.recordException(err);
    }
    span.end();
    return valid;
  }
}
