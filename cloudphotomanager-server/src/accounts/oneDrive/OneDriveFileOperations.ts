// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { File } from "../../model/File";
import axios from "axios";
import * as fs from "fs-extra";
import { OneDriveAccount } from "./OneDriveAccount";

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
}
