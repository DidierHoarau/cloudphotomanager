// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import { File } from "../../model/File";
import axios from "axios";
import { Folder } from "../../model/Folder";
import { OneDriveAccount } from "./OneDriveAccount";
import { FileMediaType } from "../../model/FileMediaType";

export class OneDriveInventory {
  //
  public static async listFilesInFolder(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    folder: Folder
  ): Promise<File[]> {
    const absoluteFolderPath = `${oneDriveAccount.getAccountDefinition().rootpath}/${folder.folderpath}`.replace(
      "//",
      "/"
    );
    const folderId = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(absoluteFolderPath)}`, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data.id;
    const children = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data.value;
    const files: File[] = [];
    for (const child of children) {
      if (!child.folder || File.getMediaType(child.name) !== FileMediaType.unknown) {
        const file = new File();
        file.accountId = oneDriveAccount.getAccountDefinition().id;
        file.idCloud = child.id;
        file.filename = child.name;
        file.folderpath = decodeURI(child.parentReference.path)
          .replace("/drive/root:", "")
          .replace(decodeURI(oneDriveAccount.getAccountDefinition().rootpath), "/")
          .replace("//", "/");
        file.dateSync = new Date();
        file.dateUpdated = new Date(child.lastModifiedDateTime);
        if (child.photo && child.photo.takenDateTime) {
          file.dateMedia = new Date(child.photo.takenDateTime);
        } else {
          file.dateMedia = new Date(child.fileSystemInfo.createdDateTime);
        }
        file.info = { test: "test" };
        file.metadata = {};
        if (child.photo) {
          file.metadata.photo = child.photo;
        }
        if (child.video) {
          file.metadata.photo = child.photo;
        }
        if (child.image) {
          file.metadata.image = child.image;
        }
        file.hash = child.file.hashes.sha256Hash;
        files.push(file);
      }
    }
    return files;
  }

  public static async listFolders(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    folderId: string,
    folders: Folder[]
  ): Promise<void> {
    const children = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data.value;
    for (const child of children) {
      if (child.folder) {
        const folder = new Folder();
        folder.accountId = oneDriveAccount.getAccountDefinition().id;
        folder.folderpath = decodeURI(`${child.parentReference.path}/${child.name}`)
          .replace("/drive/root:", "")
          .replace(decodeURI(oneDriveAccount.getAccountDefinition().rootpath), "/")
          .replace("//", "/");
        folders.push(folder);
        await OneDriveInventory.listFolders(context, oneDriveAccount, child.id, folders);
      }
    }
  }
}
