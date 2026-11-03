import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Span } from "@opentelemetry/sdk-trace";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import * as path from "path";
import {
  FileNameValidate,
  FolderPathValidate,
} from "../../files/PathValidation";
import { File } from "../../model/File";
import { OTelTracer } from "../../OTelContext";
import { AwsS3Account } from "./AwsS3Account";

export async function AwsS3AccountFileOperationsDownloadFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3Client,
  file: File,
  destinationFolderpath: string,
  destinationFilename: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsDownloadFile",
    context
  );
  const params = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  const response = await s3.send(new GetObjectCommand(params));
  if (!response.Body) {
    throw new Error(`Empty S3 body for file ${file.idCloud}`);
  }
  const fileStream = response.Body as unknown as Readable;
  const writeStream = createWriteStream(
    path.join(destinationFolderpath, destinationFilename)
  );
  await new Promise<void>((resolve, reject) => {
    fileStream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    fileStream.pipe(writeStream);
  });
  span.end();
}

export async function AwsS3AccountFileOperationsDeleteFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3Client,
  file: File
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsDeleteFile",
    context
  );
  const params = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  await s3.send(new DeleteObjectCommand(params));
  span.end();
}

// Moves a file into another folder of the same account. `folderpathDestination`
// is an application folder path (absolute, relative to the account rootpath),
// never a filename.
export async function AwsS3AccountFileOperationsMoveFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3Client,
  file: File,
  folderpathDestination: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsMoveFile",
    context
  );
  try {
    const folderError = FolderPathValidate(folderpathDestination);
    if (folderError) {
      throw new Error(`Invalid destination folder: ${folderError}`);
    }
    const filenameError = FileNameValidate(file.filename);
    if (filenameError) {
      throw new Error(`Invalid file name: ${filenameError}`);
    }
    const sourceKey = normalizeKey(file.idCloud);
    if (!sourceKey) {
      throw new Error(`Missing cloud key for file ${file.id}`);
    }
    const rootpath = awsS3Account.getAccountDefinition().rootpath || "/";
    const destinationKey = normalizeKey(
      path.posix.join("/", rootpath, folderpathDestination, file.filename)
    );
    if (destinationKey === sourceKey) {
      return;
    }
    await copyThenDelete(
      s3,
      awsS3Account.getAccountDefinition().infoPrivate.bucket,
      sourceKey,
      destinationKey
    );
  } finally {
    span.end();
  }
}

// Renames a file in place (same folder, new filename).
export async function AwsS3AccountFileOperationsRenameFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3Client,
  file: File,
  filename: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsRenameFile",
    context
  );
  try {
    const filenameError = FileNameValidate(filename);
    if (filenameError) {
      throw new Error(`Invalid file name: ${filenameError}`);
    }
    const sourceKey = normalizeKey(file.idCloud);
    if (!sourceKey) {
      throw new Error(`Missing cloud key for file ${file.id}`);
    }
    const destinationKey = path.posix.join(
      path.posix.dirname(sourceKey),
      filename
    );
    if (destinationKey === sourceKey) {
      return;
    }
    await copyThenDelete(
      s3,
      awsS3Account.getAccountDefinition().infoPrivate.bucket,
      sourceKey,
      destinationKey
    );
  } finally {
    span.end();
  }
}

// Private Functions

async function copyThenDelete(
  s3: S3Client,
  bucket: string,
  sourceKey: string,
  destinationKey: string
): Promise<void> {
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: buildCopySource(bucket, sourceKey),
      Key: destinationKey,
    })
  );
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
  } catch (err) {
    // Never leave a duplicate behind when the source delete fails: a retry
    // would otherwise copy onto an existing destination forever.
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: destinationKey })
      );
    } catch {
      // Best effort only; the original error is the actionable one.
    }
    throw err;
  }
}

// S3 copies take an URL-encoded "/bucket/key" path. Encode every segment to
// keep spaces, "#", "?" and unicode characters literal while preserving the
// separators.
function buildCopySource(bucket: string, key: string): string {
  return (
    "/" +
    encodeURIComponent(bucket) +
    "/" +
    key.split("/").map(encodeURIComponent).join("/")
  );
}

function normalizeKey(key: string): string {
  return (key || "").replace(/^\/+/, "").replace(/\/+$/, "");
}
