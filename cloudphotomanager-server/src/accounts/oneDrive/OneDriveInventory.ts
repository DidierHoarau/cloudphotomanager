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
        file.folderId = folder.id;
        file.dateSync = new Date();
        file.dateUpdated = new Date(child.lastModifiedDateTime);
        if (child.photo && child.photo.takenDateTime) {
          file.dateMedia = new Date(child.photo.takenDateTime);
        } else {
          file.dateMedia = new Date(child.fileSystemInfo.createdDateTime);
        }
        file.info = {};
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

  public static async listFoldersInFolder(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    folder: Folder
  ): Promise<Folder[]> {
    const children = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folder.idCloud}/children`, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data.value;
    const folders: Folder[] = [];
    for (const child of children) {
      if (child.folder) {
        folders.push(folderFromRaw(child, oneDriveAccount));
      }
    }
    return folders;
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
        folders.push(folderFromRaw(child, oneDriveAccount));
        await OneDriveInventory.listFolders(context, oneDriveAccount, child.id, folders);
      }
    }
  }

  public static async getFolderByPath(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    folderpath: string
  ): Promise<Folder> {
    const absoluteFolderPath = `${oneDriveAccount.getAccountDefinition().rootpath}/${folderpath.replace(
      /\/+$/,
      ""
    )}`.replace(/\/+/g, "/");
    const folderRaw = (
      await axios
        .get(`https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(absoluteFolderPath)}`, {
          headers: {
            Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
          },
        })
        .catch((err) => {
          if (err.response.status !== 404) {
            throw err;
          }
          return { data: {} };
        })
    ).data;
    if (!folderRaw.id) {
      return null;
    }
    return folderFromRaw(folderRaw, oneDriveAccount);
  }

  public static async getFolder(context: Span, oneDriveAccount: OneDriveAccount, folderIn: Folder): Promise<Folder> {
    const folderRaw = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folderIn.idCloud}`, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data;
    const folder = new Folder();
    folder.idCloud = folderRaw.id;
    folder.accountId = oneDriveAccount.getAccountDefinition().id;
    folder.folderpath = oneDriveAccount.folderToDecodedRelative(`${folderRaw.parentReference.path}/${folderRaw.name}`);
    folder.dateSync = new Date();
    folder.dateUpdated = new Date(folderRaw.lastModifiedDateTime);
    return folder;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function folderFromRaw(data: any, oneDriveAccount: OneDriveAccount): Folder {
  const folder = new Folder();
  folder.idCloud = data.id;
  folder.accountId = oneDriveAccount.getAccountDefinition().id;
  folder.folderpath = oneDriveAccount.folderToDecodedRelative(`${data.parentReference.path}/${data.name}`);
  folder.dateSync = new Date();
  folder.dateUpdated = new Date(data.lastModifiedDateTime);
  return folder;
}
