// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

import { Span } from "@opentelemetry/sdk-trace-base";
import axios, { AxiosResponse } from "axios";
import * as fs from "fs-extra";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { OTelLogger, OTelTracer } from "../../OTelContext";
import { OneDriveAccount } from "./OneDriveAccount";
import { OneDriveInventoryGetFolderByPath } from "./OneDriveInventory";

const logger = OTelLogger().createModuleLogger("OneDriveFileOperations");

const DOWNLOAD_REQUEST_TIMEOUT_MS = 30000;
const DOWNLOAD_STREAM_TIMEOUT_MS = 300000;
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

export class ItemNotFoundError extends Error {
  public constructor(idCloud: string) {
    super(`Item not found in OneDrive: ${idCloud}`);
    this.name = "ItemNotFoundError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pipeResponseToFileAndVerify(
  response: AxiosResponse,
  filePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    let receivedBytes = 0;
    const contentLengthHeader = response.headers["content-length"];
    const expectedBytes = Number(contentLengthHeader);
    const hasExpectedBytes =
      contentLengthHeader !== undefined && Number.isFinite(expectedBytes);

    const fail = async (error: Error) => {
      response.data.destroy();
      writer.destroy();
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        logger.warn(
          `Could not delete partial download ${filePath}: ${unlinkError}`,
        );
      }
      reject(error);
    };

    response.data.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });
    response.data.on("error", (error: Error) => {
      void fail(error);
    });
    writer.on("error", (error: Error) => {
      void fail(error);
    });
    writer.on("finish", () => {
      if (hasExpectedBytes && receivedBytes !== expectedBytes) {
        void fail(
          new Error(
            `Truncated download of ${filePath}: expected ${expectedBytes} bytes, received ${receivedBytes}`,
          ),
        );
        return;
      }
      resolve();
    });
    response.data.pipe(writer);
  });
}

async function requestStreamAndPipeToFile(
  url: string,
  headers: Record<string, string> | undefined,
  filePath: string,
): Promise<void> {
  const abortController = new AbortController();
  const abortTimeout = setTimeout(
    () => abortController.abort(),
    DOWNLOAD_STREAM_TIMEOUT_MS,
  );
  try {
    const response: AxiosResponse = await axios({
      url,
      method: "GET",
      responseType: "stream",
      headers,
      timeout: DOWNLOAD_REQUEST_TIMEOUT_MS,
      signal: abortController.signal,
    });
    await pipeResponseToFileAndVerify(response, filePath);
  } finally {
    clearTimeout(abortTimeout);
  }
}

export async function OneDriveFileOperationsDownloadFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folder: string,
  filename: string,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "OneDriveFileOperations_downloadFile",
    context,
  );
  const filePath = `${folder}/${filename}`;
  try {
    let attempt = 1;
    for (;;) {
      try {
        await requestStreamAndPipeToFile(
          `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}/content`,
          { Authorization: `Bearer ${await oneDriveAccount.getToken(context)}` },
          filePath,
        );
        return;
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 404) {
          throw new ItemNotFoundError(file.idCloud);
        }
        if (
          status === undefined ||
          !RETRYABLE_STATUS_CODES.includes(status) ||
          attempt >= DOWNLOAD_MAX_ATTEMPTS
        ) {
          throw error;
        }
        const delayMs = DOWNLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn(
          `Download of ${filePath} failed with HTTP ${status} (attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS}), retrying in ${delayMs}ms`,
        );
        attempt += 1;
        await sleep(delayMs);
      }
    }
  } finally {
    span.end();
  }
}

export async function OneDriveFileOperationsDownloadThumbnail(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folder: string,
  filename: string,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "OneDriveFileOperations_downloadFile",
    context,
  );
  const filePath = `${folder}/${filename}`;
  try {
    const response1 = await axios({
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}/thumbnails`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    });
    const thumbnailUrl = response1.data?.value?.[0]?.large?.url;
    if (!thumbnailUrl) {
      throw new Error(
        `OneDrive returned no large thumbnail URL for item ${file.idCloud}`,
      );
    }
    // The pre-authenticated CDN URL rejects requests carrying an Authorization header (HTTP 406)
    try {
      await requestStreamAndPipeToFile(thumbnailUrl, undefined, filePath);
      return;
    } catch (cdnError) {
      logger.warn(
        `Thumbnail CDN download failed for item ${file.idCloud}, falling back to the Graph API: ${cdnError}`,
      );
    }
    await requestStreamAndPipeToFile(
      `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}/thumbnails/0/large/content`,
      { Authorization: `Bearer ${await oneDriveAccount.getToken(context)}` },
      filePath,
    );
  } finally {
    span.end();
  }
}

export async function OneDriveFileOperationsMoveFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  folderpathDestination: string,
): Promise<void> {
  const parentFolder = await OneDriveFileOperationsEnsureFolder(
    context,
    oneDriveAccount,
    folderpathDestination,
  );
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
    },
  );
}

export async function OneDriveFileOperationsRenameFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
  filename: string,
): Promise<void> {
  await axios.patch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`,
    {
      name: filename,
    },
    {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    },
  );
}

export async function OneDriveFileOperationsDeleteFile(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  file: File,
): Promise<void> {
  await axios.delete(
    `https://graph.microsoft.com/v1.0/me/drive/items/${file.idCloud}`,
    {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    },
  );
}

export async function OneDriveFileOperationsDeleteFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folder: Folder,
): Promise<void> {
  await axios.delete(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folder.idCloud}`,
    {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    },
  );
}

export async function OneDriveFileOperationsRenameFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folder: Folder,
  newName: string,
): Promise<void> {
  await axios.patch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folder.idCloud}`,
    {
      name: newName,
    },
    {
      headers: {
        Authorization: `Bearer ${await oneDriveAccount.getToken(context)}`,
      },
    },
  );
}

export async function OneDriveFileOperationsCreateFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  parentFolder: Folder,
  foldername: string,
): Promise<Folder> {
  const span = OTelTracer().startSpan(
    "OneDriveFileOperationsCreateFolder",
    context,
  );
  const absoluteFolderPath =
    `${oneDriveAccount.getAccountDefinition().rootpath}/${
      parentFolder.folderpath
    }/${foldername}`.replace(/\/+/g, "/");
  logger.info(
    `Creating folder: ${foldername} in ${parentFolder.folderpath} / ${absoluteFolderPath}`,
  );
  const folderRaw = (
    await axios.post(
      `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolder.idCloud}/children`,
      { name: foldername, folder: {} },
      {
        headers: {
          Authorization: `Bearer ${await oneDriveAccount.getToken(span)}`,
        },
      },
    )
  ).data;
  const folder = new Folder(
    oneDriveAccount.getAccountDefinition().id,
    `${parentFolder.folderpath}/${foldername}`.replace(/\/+/g, "/"),
  );
  folder.idCloud = folderRaw.id;
  span.end();
  return folder;
}

export async function OneDriveFileOperationsEnsureFolder(
  context: Span,
  oneDriveAccount: OneDriveAccount,
  folderpath: string,
): Promise<Folder> {
  let subfolderPath = "";
  let parentFolder = await OneDriveInventoryGetFolderByPath(
    context,
    oneDriveAccount,
    subfolderPath,
  );
  for (const subFolderName of folderpath.split("/")) {
    if (subFolderName) {
      subfolderPath += `/${subFolderName}`;
      subfolderPath = subfolderPath.replace(/\/\//g, "/");
      let subFolder = await OneDriveInventoryGetFolderByPath(
        context,
        oneDriveAccount,
        subfolderPath,
      );
      if (!subFolder) {
        subFolder = await OneDriveFileOperationsCreateFolder(
          context,
          oneDriveAccount,
          parentFolder,
          subFolderName,
        );
      }
      parentFolder = subFolder;
    }
  }
  return parentFolder;
}
