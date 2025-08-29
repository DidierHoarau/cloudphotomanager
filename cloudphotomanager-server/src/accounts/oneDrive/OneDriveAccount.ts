// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import { File } from "../../model/File";
import axios from "axios";
import { Folder } from "../../model/Folder";
import { AccountCapabilities } from "../../model/AccountCapabilities";
import {
  OneDriveInventoryGetFolder,
  OneDriveInventoryGetFolderByPath,
  OneDriveInventoryListFilesInFolder,
  OneDriveInventoryListFoldersInFolder,
} from "./OneDriveInventory";
import {
  OneDriveFileOperationsDeleteFile,
  OneDriveFileOperationsDeleteFolder,
  OneDriveFileOperationsDownloadFile,
  OneDriveFileOperationsDownloadThumbnail,
  OneDriveFileOperationsMoveFile,
  OneDriveFileOperationsRenameFile,
} from "./OneDriveFileOperations";
import { OTelLogger, OTelTracer } from "../../OTelContext";

const logger = OTelLogger().createModuleLogger("OneDriveAccount");

export class OneDriveAccount implements Account {
  //
  public static TYPE = "oneDrive";
  private token: string;
  private tokenExpiration = new Date();

  private accountDefinition: AccountDefinition;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  public getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public getCapabilities(): AccountCapabilities {
    return {
      downloadPhotoThumbnail: true,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: true,
      downloadVideoPreview: false,
    };
  }

  public async updateFileMetadata(context: Span, file: File): Promise<void> {
    const span = OTelTracer().startSpan(
      "OneDriveAccount_updateFileMetadata",
      context
    );
    const info = (
      await axios.get(
        `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`,
        {
          headers: {
            Authorization: `Bearer ${await this.getToken(context)}`,
          },
        }
      )
    ).data;
    if (info.photo) {
      file.dateSync = new Date();
      file.dateUpdated = new Date(info.lastModifiedDateTime);
      file.dateMedia = new Date(info.photo.takenDateTime);
      file.metadata = { photo: info.photo, image: info.image };
      file.hash = info.file.hashes.sha256Hash;
    }
    span.end();
  }

  public async validate(context: Span): Promise<boolean> {
    const span = OTelTracer().startSpan("OneDriveAccount_validate", context);
    let valid = false;
    const params = new URLSearchParams();
    params.append("client_id", process.env.ONEDRIVE_CLIENT_ID);
    params.append("redirect_uri", process.env.ONEDRIVE_CALLBACK_SIGNIN);
    params.append("client_secret", process.env.ONEDRIVE_CLIENT_SECRET);
    params.append("code", this.accountDefinition.infoPrivate.authCode);
    params.append("grant_type", "authorization_code");
    await axios
      .post(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        params
      )
      .then((res) => {
        if (res.data.access_token) {
          this.accountDefinition.infoPrivate.accessToken =
            res.data.access_token;
          this.accountDefinition.infoPrivate.refreshToken =
            res.data.refresh_token;
          valid = true;
        }
      })
      .catch((err) => {
        logger.error(err);
        span.recordException(err);
      });
    span.end();
    return valid;
  }

  public async getToken(context: Span): Promise<string> {
    if (new Date() > this.tokenExpiration) {
      const span = OTelTracer().startSpan("OneDriveAccount_getToken", context);
      const params = new URLSearchParams();
      params.append("client_id", process.env.ONEDRIVE_CLIENT_ID);
      params.append("redirect_uri", process.env.ONEDRIVE_CALLBACK_SIGNIN);
      params.append("client_secret", process.env.ONEDRIVE_CLIENT_SECRET);
      params.append(
        "refresh_token",
        this.accountDefinition.infoPrivate.refreshToken
      );
      params.append("grant_type", "refresh_token");
      await axios
        .post(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          params
        )
        .then((res) => {
          this.token = res.data.access_token;
          this.tokenExpiration = new Date(
            new Date().getTime() + parseInt(res.data.expires_in) * 1000 * 0.8
          );
        });
      span.end();
    }
    return this.token;
  }

  public async listFilesInFolder(
    context: Span,
    folder: Folder
  ): Promise<File[]> {
    return await OneDriveInventoryListFilesInFolder(context, this, folder);
  }

  public async listFoldersInFolder(
    context: Span,
    folder: Folder
  ): Promise<Folder[]> {
    return await OneDriveInventoryListFoldersInFolder(context, this, folder);
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string
  ): Promise<void> {
    await OneDriveFileOperationsDownloadFile(
      context,
      this,
      file,
      destinationFolderpath,
      destinationFilename
    );
  }

  public async downloadPreview(
    context: Span,
    file: File,
    folder: string,
    filename: string
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  public async downloadThumbnail(
    context: Span,
    file: File,
    folderpath: string,
    filename: string
  ): Promise<void> {
    await OneDriveFileOperationsDownloadThumbnail(
      context,
      this,
      file,
      folderpath,
      filename
    );
  }

  public async moveFile(
    context: Span,
    file: File,
    folderpathDestination: string
  ): Promise<void> {
    await OneDriveFileOperationsMoveFile(
      context,
      this,
      file,
      folderpathDestination
    );
  }

  public async deleteFile(context: Span, file: File): Promise<void> {
    await OneDriveFileOperationsDeleteFile(context, this, file);
  }

  public async getFolder(context: Span, folder: Folder): Promise<Folder> {
    return await OneDriveInventoryGetFolder(context, this, folder);
  }

  public async getFolderByPath(
    context: Span,
    folderpath: string
  ): Promise<Folder> {
    return await OneDriveInventoryGetFolderByPath(context, this, folderpath);
  }

  public folderToEncodedAbsolute(relativePath: string): string {
    return encodeURI(
      `${this.accountDefinition.rootpath}/${relativePath.replace(/\/+$/, "")}`.replace(
        /\/+/g,
        "/"
      )
    );
  }

  public async deleteFolder(context: Span, folder: Folder): Promise<void> {
    await OneDriveFileOperationsDeleteFolder(context, this, folder);
  }

  async renameFile(context: Span, file: File, filename: string): Promise<void> {
    await OneDriveFileOperationsRenameFile(context, this, file, filename);
  }

  public folderToDecodedRelative(absolutePath: string): string {
    return decodeURI(absolutePath)
      .replace(this.accountDefinition.rootpath, "/")
      .replace("/drive/root:", "")
      .replace(/\/+/g, "/");
  }
}
