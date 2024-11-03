// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import { File } from "../../model/File";
import axios from "axios";
import { Folder } from "../../model/Folder";
import { OneDriveAccount } from "./OneDriveAccount";
import { FileMediaType } from "../../model/FileMediaType";

export async function OneDriveInventoryListFilesInFolder(
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
  const files: File[] = [];
  let queryUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
  do {
    const children = (
      await axios.get(queryUrl, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data;
    for (const child of children.value) {
      if (!child.folder || File.getMediaType(child.name) !== FileMediaType.unknown) {
        files.push(fileFromRaw(child, folderId, oneDriveAccount));
      }
    }
    queryUrl = children["@odata.nextLink"];
  } while (queryUrl);
  return files;
}

export async function OneDriveInventoryListFoldersInFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folder: Folder
): Promise<Folder[]> {
  let queryUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folder.idCloud}/children`;
  const folders: Folder[] = [];
  do {
    const children = (
      await axios.get(queryUrl, {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      })
    ).data;
    for (const child of children.value) {
      if (child.folder) {
        folders.push(folderFromRaw(child, oneDriveAccount));
      }
    }
    queryUrl = children["@odata.nextLink"];
  } while (queryUrl);
  return folders;
}

export async function OneDriveInventoryListFolders(
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
      await OneDriveInventoryListFolders(context, oneDriveAccount, child.id, folders);
    }
  }
}

export async function OneDriveInventoryGetFolderByPath(
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

export async function OneDriveInventoryGetFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folderIn: Folder
): Promise<Folder> {
  const folderRaw = (
    await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folderIn.idCloud}`, {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    })
  ).data;
  return folderFromRaw(folderRaw, oneDriveAccount);
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function folderFromRaw(data: any, oneDriveAccount: OneDriveAccount): Folder {
  const folder = new Folder(
    oneDriveAccount.getAccountDefinition().id,
    oneDriveAccount.folderToDecodedRelative(`${data.parentReference.path}/${data.name}`)
  );
  folder.idCloud = data.id;
  folder.dateSync = new Date();
  folder.dateUpdated = new Date(data.lastModifiedDateTime);
  return folder;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fileFromRaw(data: any, folderId: string, oneDriveAccount: OneDriveAccount): File {
  const file = new File(oneDriveAccount.getAccountDefinition().id, folderId, data.name);
  file.idCloud = data.id;
  file.dateSync = new Date();
  file.dateUpdated = new Date(data.lastModifiedDateTime);
  if (data.photo && data.photo.takenDateTime) {
    file.dateMedia = new Date(data.photo.takenDateTime);
  } else {
    file.dateMedia = new Date(data.fileSystemInfo.createdDateTime);
  }
  file.info = {
    size: data.size,
  };
  file.metadata = {};
  if (data.photo) {
    file.metadata.photo = data.photo;
  }
  if (data.video) {
    file.metadata.photo = data.photo;
  }
  if (data.image) {
    file.metadata.image = data.image;
  }
  file.hash = data.file.hashes.sha256Hash;
  return file;
}
