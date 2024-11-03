// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import axios from "axios";
import * as fs from "fs-extra";
import { OneDriveAccount } from "./OneDriveAccount";
import { Logger } from "../../utils-std-ts/Logger";
import { Folder } from "../../model/Folder";
import { OneDriveInventoryGetFolderByPath } from "./OneDriveInventory";

const logger = new Logger("OneDriveFileOperations");

export async function OneDriveFileOperationsDownloadFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folder: string,
  filename: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const span = StandardTracerStartSpan("OneDriveFileOperations_downloadFile", context);
    axios({
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}/content`,
      method: "GET",
      responseType: "stream",
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    })
      .then((response) => {
        const writer = fs.createWriteStream(`${folder}/${filename}`);
        response.data.pipe(writer);
        writer.on("finish", () => {
          resolve();
        });
        writer.on("error", (error) => {
          reject(error);
        });
      })
      .catch((error) => {
        reject(error);
      })
      .finally(() => {
        span.end();
      });
  });
}

export async function OneDriveFileOperationsDownloadThumbnail(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folder: string,
  filename: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const span = StandardTracerStartSpan("OneDriveFileOperations_downloadFile", context);
    axios({
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}/thumbnails`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    })
      .then(async (response) => {
        return axios({
          url: `${response.data.value[0].large.url}`,
          method: "GET",
          responseType: "stream",
          headers: {
            Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
          },
        });
      })
      .then((response) => {
        const writer = fs.createWriteStream(`${folder}/${filename}`);
        response.data.pipe(writer);
        writer.on("finish", () => {
          resolve();
        });
        writer.on("error", (error) => {
          reject(error);
        });
      })
      .catch((error) => {
        reject(error);
      })
      .finally(() => {
        span.end();
      });
  });
}

export async function OneDriveFileOperationsMoveFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folderpathDestination: string
): Promise<void> {
  const parentFolder = await OneDriveFileOperationsensureFolder(context, oneDriveAccount, folderpathDestination);
  await axios.patch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`,
    {
      parentReference: {
        id: parentFolder.idCloud,
      },
      name: file.filename,
    },
    {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    }
  );
}

export async function OneDriveFileOperationsdeleteFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File
): Promise<void> {
  await axios.delete(`https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`, {
    headers: {
      Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
    },
  });
}

export async function OneDriveFileOperationscreateFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  parentFolder: Folder,
  foldername: string
): Promise<Folder> {
  const absoluteFolderPath = `${oneDriveAccount.getAccountDefinition().rootpath}/${
    parentFolder.folderpath
  }/${foldername}`.replace(/\/+/g, "/");
  logger.info(`Creating folder: ${foldername} in ${parentFolder.folderpath} / ${absoluteFolderPath}`);
  const folderRaw = (
    await axios.post(
      `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolder.idCloud}/children`,
      { name: foldername, folder: {} },
      {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
        },
      }
    )
  ).data;
  const folder = new Folder(
    oneDriveAccount.getAccountDefinition().id,
    `${parentFolder.folderpath}/${foldername}`.replace(/\/+/g, "/")
  );
  folder.idCloud = folderRaw.id;
  return folder;
}

export async function OneDriveFileOperationsensureFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folderpath: string
): Promise<Folder> {
  let subfolderPath = "";
  let parentFolder = await OneDriveInventoryGetFolderByPath(context, oneDriveAccount, subfolderPath);
  for (const subFolderName of folderpath.split("/")) {
    if (subFolderName) {
      subfolderPath += `/${subFolderName}`;
      subfolderPath = subfolderPath.replace(/\/\//g, "/");
      let subFolder = await OneDriveInventoryGetFolderByPath(context, oneDriveAccount, subfolderPath);
      if (!subFolder) {
        subFolder = await OneDriveFileOperationscreateFolder(context, oneDriveAccount, parentFolder, subFolderName);
      }
      parentFolder = subFolder;
    }
  }
  return parentFolder;
}
