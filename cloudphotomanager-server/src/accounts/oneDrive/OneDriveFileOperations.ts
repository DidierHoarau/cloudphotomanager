// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import axios from "axios";
import * as fs from "fs-extra";
import { OneDriveAccount } from "./OneDriveAccount";
import { Logger } from "../../utils-std-ts/Logger";
import { Folder } from "../../model/Folder";

const logger = new Logger("OneDriveFileOperations");
export class OneDriveFileOperations {
  //
  public static async downloadFile(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    file: File,
    folder: string,
    filename: string
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const span = StandardTracer.startSpan("OneDriveFileOperations_downloadFile", context);
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

  public static async moveFile(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    file: File,
    folderpathDestination: string
  ): Promise<void> {
    const parentFolder = await OneDriveFileOperations.ensureFolder(context, oneDriveAccount, folderpathDestination);
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
    const folder = new Folder();
    folder.idCloud = folderRaw.id;
    folder.folderpath = folderpath || "/";
    folder.accountId = oneDriveAccount.getAccountDefinition().id;
    return folder;
  }

  public static async createFolder(
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
        `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolder.id}/children`,
        { name: foldername, folder: {} },
        {
          headers: {
            Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
          },
        }
      )
    ).data;
    const folder = new Folder();
    folder.idCloud = folderRaw.id;
    folder.folderpath = `${parentFolder.folderpath}/${foldername}`.replace(/\/+/g, "/");
    folder.accountId = oneDriveAccount.getAccountDefinition().id;
    return folder;
  }

  public static async ensureFolder(
    context: Span,
    oneDriveAccount: OneDriveAccount,
    folderpath: string
  ): Promise<Folder> {
    let subfolderPath = "";
    let parentFolder = await OneDriveFileOperations.getFolderByPath(context, oneDriveAccount, subfolderPath);
    for (const subFolderName of folderpath.split("/")) {
      if (subFolderName) {
        subfolderPath += `/${subFolderName}`;
        subfolderPath = subfolderPath.replace(/\/\//g, "/");
        let subFolder = await OneDriveFileOperations.getFolderByPath(context, oneDriveAccount, subfolderPath);
        if (!subFolder) {
          subFolder = await OneDriveFileOperations.createFolder(context, oneDriveAccount, parentFolder, subFolderName);
        }
        parentFolder = subFolder;
      }
    }
    return parentFolder;
  }
}
