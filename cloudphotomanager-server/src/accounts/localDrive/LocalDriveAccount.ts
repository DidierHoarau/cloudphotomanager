import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
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
import { OTelTracer } from "../../OTelContext";
import { PathIsInsideRoot } from "../../files/PathValidation";

export class LocalAccount implements Account {
  //
  public static TYPE = "localDrive";

  private accountDefinition: AccountDefinition;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  getCapabilities(): AccountCapabilities {
    return {
      downloadFileOriginal: true,
      downloadPhotoThumbnail: false,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: false,
      downloadVideoPreview: false,
    };
  }

  private assertInsideRoot(...targets: string[]): void {
    for (const target of targets) {
      if (!PathIsInsideRoot(this.accountDefinition.rootpath, target)) {
        throw new Error("Path outside account root");
      }
    }
  }

  async deleteFile(context: Span, file: File): Promise<void> {
    this.assertInsideRoot(file.idCloud);
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

  async moveFile(
    context: Span,
    file: File,
    folderpathDestination: string,
  ): Promise<void> {
    const destination = path.join(
      this.accountDefinition.rootpath,
      folderpathDestination,
      file.filename,
    );
    this.assertInsideRoot(file.idCloud, destination);
    await fs.move(file.idCloud, destination);
  }

  async listFilesInFolder(context: Span, folder: Folder): Promise<File[]> {
    return LocalAccountInventoryListFilesInFolder(context, this, folder);
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  async renameFile(context: Span, file: File, filename: string): Promise<void> {
    const destination = path.join(path.dirname(file.idCloud), filename);
    this.assertInsideRoot(file.idCloud, destination);
    await fs.move(file.idCloud, destination);
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string,
  ): Promise<void> {
    this.assertInsideRoot(file.idCloud);
    await fs.copyFile(
      file.idCloud,
      path.join(destinationFolderpath, destinationFilename),
    );
  }

  public async deleteFolder(context: Span, folder: Folder): Promise<void> {
    this.assertInsideRoot(folder.idCloud);
    await fs.rm(folder.idCloud, { recursive: true, force: true });
  }

  public async renameFolder(
    context: Span,
    folder: Folder,
    newName: string,
  ): Promise<void> {
    const parentDir = path.dirname(folder.idCloud);
    const destination = path.join(parentDir, newName);
    this.assertInsideRoot(folder.idCloud, destination);
    await fs.move(folder.idCloud, destination);
  }

  public async validate(context: Span): Promise<boolean> {
    const span = OTelTracer().startSpan("LocalAccount_validate", context);
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

  // Non Supported Features

  updateFileMetadata(_context: Span, _file: File): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadPreview(
    _context: Span,
    _file: File,
    _folder: string,
    _filename: string,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadThumbnail(
    _context: Span,
    _file: File,
    _folder: string,
    _filename: string,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  listFolders(_context: Span): Promise<Folder[]> {
    throw new Error("Method not implemented.");
  }
}
