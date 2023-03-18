// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import axios from "axios";
import { Logger } from "../../utils-std-ts/Logger";
import { Folder } from "../../model/Folder";
import { OneDriveFileOperations } from "./OneDriveFileOperations";
import { OneDriveInventory } from "./OneDriveInventory";

const logger = new Logger("OneDriveAccount");

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

  public async updateFileMetadata(context: Span, file: File): Promise<void> {
    const span = StandardTracer.startSpan("OneDriveAccount_updateFileMetadata", context);
    const info = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`, {
        headers: {
          Authorization: `Bearer ${await this.getToken(context)}`,
        },
      })
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
    const span = StandardTracer.startSpan("OneDriveAccount_validate", context);
    let valid = false;
    const params = new URLSearchParams();
    params.append("client_id", process.env.ONEDRIVE_CLIENT_ID);
    params.append("redirect_uri", process.env.ONEDRIVE_CALLBACK_SIGNIN);
    params.append("client_secret", process.env.ONEDRIVE_CLIENT_SECRET);
    params.append("code", this.accountDefinition.infoPrivate.authCode);
    params.append("grant_type", "authorization_code");
    await axios
      .post("https://login.microsoftonline.com/common/oauth2/v2.0/token", params)
      .then((res) => {
        if (res.data.access_token) {
          this.accountDefinition.infoPrivate.accessToken = res.data.access_token;
          this.accountDefinition.infoPrivate.refreshToken = res.data.refresh_token;
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
      const span = StandardTracer.startSpan("OneDriveAccount_getToken", context);
      const params = new URLSearchParams();
      params.append("client_id", process.env.ONEDRIVE_CLIENT_ID);
      params.append("redirect_uri", process.env.ONEDRIVE_CALLBACK_SIGNIN);
      params.append("client_secret", process.env.ONEDRIVE_CLIENT_SECRET);
      params.append("refresh_token", this.accountDefinition.infoPrivate.refreshToken);
      params.append("grant_type", "refresh_token");
      await axios.post("https://login.microsoftonline.com/common/oauth2/v2.0/token", params).then((res) => {
        this.token = res.data.access_token;
        this.tokenExpiration = new Date(new Date().getTime() + parseInt(res.data.expires_in) * 1000 * 0.8);
      });
      span.end();
    }
    return this.token;
  }

  async listFolders(context: Span): Promise<Folder[]> {
    const span = StandardTracer.startSpan("OneDriveAccount_listFiles", context);
    const folders: Folder[] = [];
    const rootFolderId = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(this.accountDefinition.rootpath)}`, {
        headers: {
          Authorization: `Bearer ${await this.getToken(span)}`,
        },
      })
    ).data.id;
    const folder = new Folder();
    folder.accountId = this.accountDefinition.id;
    folder.folderpath = "/";
    folders.push(folder);
    await OneDriveInventory.listFolders(span, this, rootFolderId, folders);
    span.end();
    return folders;
  }

  public async listFileInFolders(context: Span, folder: Folder): Promise<File[]> {
    return await OneDriveInventory.listFilesInFolder(context, this, folder);
  }

  public async downloadFile(context: Span, file: File, folderpath: string, filename: string): Promise<void> {
    await OneDriveFileOperations.downloadFile(context, this, file, folderpath, filename);
  }
}
