// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace";
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
  OneDriveFileOperationsRenameFolder,
} from "./OneDriveFileOperations";
import { OTelLogger, OTelTracer } from "../../OTelContext";
import { AccountDataUpdateTokens } from "../AccountData";

const logger = OTelLogger().createModuleLogger("OneDriveAccount");
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export class OneDriveAccount implements Account {
  //
  public static TYPE = "oneDrive";
  private token: string;
  private tokenExpiration = new Date();
  private tokenRefreshInFlight: Promise<string> | null = null;

  private accountDefinition: AccountDefinition;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  public getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public getCapabilities(): AccountCapabilities {
    return {
      downloadFileOriginal: true,
      downloadPhotoThumbnail: true,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: true,
      downloadVideoPreview: false,
    };
  }

  public async updateFileMetadata(context: Span, file: File): Promise<void> {
    const span = OTelTracer().startSpan(
      "OneDriveAccount_updateFileMetadata",
      context,
    );
    const info = (
      await axios.get(
        `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`,
        {
          headers: {
            Authorization: `Bearer ${await this.getToken(context)}`,
          },
        },
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
      .post(TOKEN_ENDPOINT, params)
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
        logger.error("Error Validating OneDrive Account", err, span);
      });
    span.end();
    return valid;
  }

  public async getToken(context: Span): Promise<string> {
    if (this.token && new Date() <= this.tokenExpiration) {
      return this.token;
    }
    // Refresh tokens rotate on every use. Concurrent callers must share one
    // refresh, otherwise they consume the same token and all but one fail
    // with invalid_grant.
    if (!this.tokenRefreshInFlight) {
      this.tokenRefreshInFlight = this.refreshToken(context).finally(() => {
        this.tokenRefreshInFlight = null;
      });
    }
    return this.tokenRefreshInFlight;
  }

  private async refreshToken(context: Span): Promise<string> {
    const span = OTelTracer().startSpan("OneDriveAccount_getToken", context);
    try {
      const refreshToken = this.accountDefinition.infoPrivate?.refreshToken;
      if (!refreshToken) {
        throw new Error(
          "OneDrive account is not authorized (missing refresh token) — reconnect the account in Settings → Accounts",
        );
      }
      const params = new URLSearchParams();
      params.append("client_id", process.env.ONEDRIVE_CLIENT_ID);
      params.append("redirect_uri", process.env.ONEDRIVE_CALLBACK_SIGNIN);
      params.append("client_secret", process.env.ONEDRIVE_CLIENT_SECRET);
      params.append("refresh_token", refreshToken);
      params.append("grant_type", "refresh_token");
      const res = await axios.post(TOKEN_ENDPOINT, params);
      if (!res.data?.access_token) {
        throw new Error("OneDrive token refresh returned no access token");
      }
      this.token = res.data.access_token;
      const expiresIn = parseInt(res.data.expires_in, 10);
      this.tokenExpiration = new Date(
        Date.now() +
          (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 * 0.8,
      );
      // Microsoft replaces the refresh token on every use; keep the latest
      // one, otherwise the stored token eventually expires and every sync
      // fails with invalid_grant.
      if (res.data.refresh_token) {
        this.accountDefinition.infoPrivate.refreshToken = res.data.refresh_token;
        try {
          await AccountDataUpdateTokens(
            span,
            this.accountDefinition.id,
            this.accountDefinition.infoPrivate,
          );
        } catch (err) {
          // The current sync still has a valid access token; the next refresh
          // will persist the token again.
          logger.error("Error Persisting OneDrive Refresh Token", err, span);
        }
      }
      return this.token;
    } catch (err) {
      const described = OneDriveTokenErrorDescribe(err);
      logger.error(
        "Error Refreshing OneDrive Token",
        new Error(described),
        span,
      );
      throw new Error(described);
    } finally {
      span.end();
    }
  }

  public async listFilesInFolder(
    context: Span,
    folder: Folder,
  ): Promise<File[]> {
    return await OneDriveInventoryListFilesInFolder(context, this, folder);
  }

  public async listFoldersInFolder(
    context: Span,
    folder: Folder,
  ): Promise<Folder[]> {
    return await OneDriveInventoryListFoldersInFolder(context, this, folder);
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string,
  ): Promise<void> {
    await OneDriveFileOperationsDownloadFile(
      context,
      this,
      file,
      destinationFolderpath,
      destinationFilename,
    );
  }

  public async downloadPreview(
    _context: Span,
    _file: File,
    _folder: string,
    _filename: string,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  public async downloadThumbnail(
    context: Span,
    file: File,
    folderpath: string,
    filename: string,
  ): Promise<void> {
    await OneDriveFileOperationsDownloadThumbnail(
      context,
      this,
      file,
      folderpath,
      filename,
    );
  }

  public async moveFile(
    context: Span,
    file: File,
    folderpathDestination: string,
  ): Promise<void> {
    await OneDriveFileOperationsMoveFile(
      context,
      this,
      file,
      folderpathDestination,
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
    folderpath: string,
  ): Promise<Folder> {
    return await OneDriveInventoryGetFolderByPath(context, this, folderpath);
  }

  public folderToEncodedAbsolute(relativePath: string): string {
    return encodeURI(
      `${this.accountDefinition.rootpath}/${relativePath.replace(/\/+$/, "")}`.replace(
        /\/+/g,
        "/",
      ),
    );
  }

  public async deleteFolder(context: Span, folder: Folder): Promise<void> {
    await OneDriveFileOperationsDeleteFolder(context, this, folder);
  }

  public async renameFolder(
    context: Span,
    folder: Folder,
    newName: string,
  ): Promise<void> {
    await OneDriveFileOperationsRenameFolder(context, this, folder, newName);
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

// Turn an OAuth token-endpoint failure into a message that tells the user what
// to do, while keeping the provider's error code/description for diagnosis.
// Refresh token and client secret values are never included.
function OneDriveTokenErrorDescribe(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: any } })
    ?.response;
  const data = response?.data;
  const oauthError =
    typeof data?.error === "string" ? data.error : undefined;
  const description =
    typeof data?.error_description === "string"
      ? data.error_description
      : undefined;
  if (
    oauthError ||
    response?.status === 400 ||
    response?.status === 401 ||
    response?.status === 403
  ) {
    const detail = [oauthError, description].filter(Boolean).join(": ");
    const status = response?.status ? `HTTP ${response.status}` : "";
    const suffix = detail || status;
    return (
      "OneDrive authorization failed — reconnect the account in Settings → Accounts" +
      (suffix ? ` (${suffix})` : "")
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return `OneDrive token refresh failed: ${message}`;
}
