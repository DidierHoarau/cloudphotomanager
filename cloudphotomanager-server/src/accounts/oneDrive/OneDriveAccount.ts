import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import axios from "axios";
import { Logger } from "../../utils-std-ts/Logger";
import { encode, decode } from "html-entities";

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

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  async listFiles(context: Span): Promise<File[]> {
    const span = StandardTracer.startSpan("OneDriveAccount_listFiles", context);
    const files: File[] = [];

    const rootFolderId = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:${this.accountDefinition.rootpath}`, {
        headers: {
          Authorization: `Bearer ${await this.getToken(span)}`,
        },
      })
    ).data.id;

    await this.listAllFiles(span, rootFolderId, files);

    span.end();
    return files;
  }

  public async downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void> {
    const span = StandardTracer.startSpan("OneDriveAccount_downloadFile", context);
    span.end();
    throw new Error("OneDriveAccount_downloadFile Not Implemented Yet");
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

  private async getToken(context: Span): Promise<string> {
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

  private async listAllFiles(context: Span, folderId: string, files: File[]): Promise<void> {
    const children = (
      await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`, {
        headers: {
          Authorization: `Bearer ${await this.getToken(context)}`,
        },
      })
    ).data.value;

    for (const child of children) {
      if (child.folder) {
        await this.listAllFiles(context, child.id, files);
      } else {
        const file = new File();
        file.accountId = this.accountDefinition.id;
        file.idCloud = child.id;
        file.filename = child.name;
        file.folderpath = child.parentReference.path
          .replace("/drive/root:", "")
          .replace(this.accountDefinition.rootpath, "")
          .replaceAll("%20", " ");
        file.dateSync = new Date();
        file.dateUpdated = new Date(child.lastModifiedDateTime);
        file.hash = child.file.hashes.sha256Hash;
        files.push(file);
      }
    }
  }
}
