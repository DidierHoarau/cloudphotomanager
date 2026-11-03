import Config from "./Config";

// Browsers without the File System Access API keep the whole archive in
// memory: refuse selections that could freeze or crash the tab.
export const MAX_BUFFERED_FILES = 100;
export const MAX_BUFFERED_BYTES = 512 * 1024 * 1024;

interface BulkDownloadFile {
  id: string;
  filename?: string;
  info?: { size?: number };
}

interface FileSystemWritableFileStreamLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

type ShowSaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandleLike>;

export function buildZipFilename(date: Date = new Date()): string {
  return `photos-${date
    .toISOString()
    .replace(/[:.]/g, "-")
    .substring(0, 19)}.zip`;
}

// Shape the error like an axios error so the shared handleError() shows the
// server-provided message.
async function downloadError(response: Response): Promise<Error> {
  let message = `HTTP error ${response.status}`;
  try {
    const data = await response.json();
    if (data && typeof data.error === "string" && data.error.length > 0) {
      message = data.error;
    }
  } catch {
    // keep the status-based message
  }
  const error: any = new Error(message);
  error.response = { status: response.status, data: { error: message } };
  return error;
}

export class BulkDownloadService {
  public static async downloadZip(
    accountId: string,
    files: BulkDownloadFile[],
  ): Promise<void> {
    const zipName = buildZipFilename();
    const url = `${Config.sync.SERVER_URL}/accounts/${accountId}/files/batch/operations/fileDownload`;
    const requestInit: RequestInit = {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIdList: files.map((file) => file.id) }),
    };

    const pickerHost = window as unknown as {
      showSaveFilePicker?: ShowSaveFilePicker;
      isSecureContext?: boolean;
    };
    if (
      typeof pickerHost.showSaveFilePicker === "function" &&
      pickerHost.isSecureContext
    ) {
      let handle: FileSystemFileHandleLike | null = null;
      try {
        // Open the picker before fetching to preserve user activation.
        handle = await pickerHost.showSaveFilePicker({
          suggestedName: zipName,
          types: [
            {
              description: "Zip archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
        // Any other picker failure falls back to the buffered download.
        handle = null;
      }
      if (handle) {
        await this.downloadStreamed(url, requestInit, handle);
        return;
      }
    }

    await this.downloadBuffered(url, requestInit, files, zipName);
  }

  // Constant browser memory: the response body is piped straight to disk.
  private static async downloadStreamed(
    url: string,
    requestInit: RequestInit,
    handle: FileSystemFileHandleLike,
  ): Promise<void> {
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      throw await downloadError(response);
    }
    if (!response.body) {
      throw new Error("The server response cannot be streamed");
    }
    const writable = await handle.createWritable();
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await writable.write(value);
      }
      await writable.close();
    } catch (err) {
      try {
        await writable.abort?.(err);
      } catch {
        // the original error is the useful one
      }
      throw err;
    }
  }

  private static async downloadBuffered(
    url: string,
    requestInit: RequestInit,
    files: BulkDownloadFile[],
    zipName: string,
  ): Promise<void> {
    const totalBytes = files.reduce(
      (sum, file) => sum + (file.info?.size ?? 0),
      0,
    );
    if (files.length > MAX_BUFFERED_FILES || totalBytes > MAX_BUFFERED_BYTES) {
      throw new Error(
        `This browser cannot stream downloads: select at most ${MAX_BUFFERED_FILES} files or ${Math.round(
          MAX_BUFFERED_BYTES / (1024 * 1024),
        )} MiB per download`,
      );
    }
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      throw await downloadError(response);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }
}
