import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import { FileMediaType } from "../../model/FileMediaType";
import * as fs from "fs-extra";
import axios from "axios";
import { Logger } from "../../utils-std-ts/Logger";

const logger = new Logger("OneDriveAccount");

export class OneDriveAccount implements Account {
  //
  public static TYPE = "oneDrive";

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
    span.end();
    return files;
  }

  public async downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void> {
    const span = StandardTracer.startSpan("OneDriveAccount_downloadFile", context);
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
}
