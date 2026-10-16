import { Span } from "@opentelemetry/sdk-trace-base";
import * as fs from "fs-extra";
import * as path from "path";
import { Account } from "../model/Account";
import { File } from "../model/File";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { FileDataGetFileTmpDir } from "./FileData";

const logger = OTelLogger().createModuleLogger("FileDownload");

const CONTENT_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  dng: "image/x-adobe-dng",
  flv: "video/x-flv",
  gif: "image/gif",
  heic: "image/heic",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  png: "image/png",
  tiff: "image/tiff",
  webp: "image/webp",
  wmv: "video/x-ms-wmv",
};

function contentTypeFor(filename: string): string {
  const extension = filename.split(".").pop().toLowerCase();
  return CONTENT_TYPES[extension] || "application/octet-stream";
}

// Downloads the original file from the account into a temp dir and streams it
// to the response. `disposition` is "attachment" (save) or "inline" (open in
// the browser). The temp dir is removed once the stream has been consumed.
export async function FileDownloadStreamOriginal(
  context: Span,
  account: Account,
  file: File,
  res: any,
  disposition: "attachment" | "inline",
): Promise<void> {
  const span = OTelTracer().startSpan("FileDownload_streamOriginal", context);
  let tmpDir: string = null;
  try {
    tmpDir = await FileDataGetFileTmpDir(span, file.accountId, file.id);
    await fs.ensureDir(tmpDir);
    await account.downloadFile(span, file, tmpDir, file.filename);
    const filepath = path.join(tmpDir, file.filename);
    const stats = await fs.stat(filepath);
    res.header("Content-Type", contentTypeFor(file.filename));
    res.header(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.header("Content-Length", stats.size);
    const stream = fs.createReadStream(filepath);
    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      res.send(stream);
    });
  } catch (err) {
    logger.error("Error Downloading Original File", err, span);
    throw err;
  } finally {
    if (tmpDir) {
      await fs.remove(tmpDir).catch((err) => {
        logger.error("Error Removing Download Temp Dir", err, span);
      });
    }
    span.end();
  }
}
