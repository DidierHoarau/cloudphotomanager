import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import * as path from "path";
import {
  FileNameValidate,
  FolderPathValidate,
} from "../../files/PathValidation";
import { Folder } from "../../model/Folder";
import { OTelTracer } from "../../OTelContext";
import { AwsS3Account } from "./AwsS3Account";

// S3 has no real folders: a folder is the prefix shared by its keys plus an
// optional zero-byte marker object (key === prefix). Siblings such as
// "<prefix>-backup/..." share the listing prefix but are not part of it.
const DELETE_BATCH_SIZE = 1000;

export async function AwsS3AccountFolderOperationsDeleteFolder(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folder: Folder
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFolderOperationsDeleteFolder",
    context
  );
  try {
    const folderKey = resolveFolderKey(awsS3Account, folder);
    const keys = await listFolderKeys(s3, bucketOf(awsS3Account), folderKey);
    await deleteKeys(s3, bucketOf(awsS3Account), keys);
  } finally {
    span.end();
  }
}

// Renames a folder by copying every key of the old prefix to the new one
// (preserving the suffix) and deleting the old keys afterwards. Refuses to
// merge into an existing prefix.
export async function AwsS3AccountFolderOperationsRenameFolder(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folder: Folder,
  newName: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFolderOperationsRenameFolder",
    context
  );
  try {
    const nameError = FileNameValidate(newName);
    if (nameError) {
      throw new Error(`Invalid folder name: ${nameError}`);
    }
    const bucket = bucketOf(awsS3Account);
    const sourceKey = resolveFolderKey(awsS3Account, folder);
    const destinationKey = normalizeKey(
      path.posix.join(path.posix.dirname(sourceKey), newName)
    );
    if (!destinationKey || destinationKey === sourceKey) {
      throw new Error(`Invalid destination folder name: ${newName}`);
    }
    if (destinationKey === rootKeyOf(awsS3Account)) {
      throw new Error("Cannot rename a folder to the account root");
    }

    const conflictingKeys = await listFolderKeys(s3, bucket, destinationKey);
    if (conflictingKeys.length > 0) {
      throw new Error(
        `Destination folder already exists: ${destinationKey}`
      );
    }

    const sourceKeys = await listFolderKeys(s3, bucket, sourceKey);
    for (const key of sourceKeys) {
      await s3
        .copyObject({
          Bucket: bucket,
          CopySource: buildCopySource(bucket, key),
          Key: destinationKey + key.slice(sourceKey.length),
        })
        .promise();
    }
    // Only delete the old prefix once every copy succeeded: a partial copy is
    // retried safely instead of losing the whole folder.
    await deleteKeys(s3, bucket, sourceKeys);
  } finally {
    span.end();
  }
}

// Private Functions

function bucketOf(awsS3Account: AwsS3Account): string {
  return awsS3Account.getAccountDefinition().infoPrivate.bucket;
}

function rootKeyOf(awsS3Account: AwsS3Account): string {
  return normalizeKey(awsS3Account.getAccountDefinition().rootpath || "/");
}

// Validates that the folder is a real sub-folder (never the account root)
// and returns its normalized key prefix.
function resolveFolderKey(
  awsS3Account: AwsS3Account,
  folder: Folder
): string {
  const folderPathError = FolderPathValidate(folder?.folderpath);
  if (folderPathError) {
    throw new Error(`Invalid folder path: ${folderPathError}`);
  }
  if (folder.folderpath === "/") {
    throw new Error("Refusing to operate on the account root folder");
  }
  const folderKey = normalizeKey(folder.idCloud);
  if (!folderKey) {
    throw new Error(`Missing cloud key for folder ${folder.id}`);
  }
  if (folderKey.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid folder cloud key: ${folder.idCloud}`);
  }
  if (folderKey === rootKeyOf(awsS3Account)) {
    throw new Error("Refusing to operate on the account root folder");
  }
  return folderKey;
}

// Lists every key belonging to the folder prefix: the marker object itself
// (key === prefix) and all nested keys (key starts with "<prefix>/").
async function listFolderKeys(
  s3: S3,
  bucket: string,
  folderKey: string
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: folderKey,
        ContinuationToken: continuationToken,
      })
      .promise();
    for (const item of response.Contents || []) {
      if (
        item.Key === folderKey ||
        item.Key.startsWith(`${folderKey}/`)
      ) {
        keys.push(item.Key);
      }
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

async function deleteKeys(
  s3: S3,
  bucket: string,
  keys: string[]
): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
    const response = await s3
      .deleteObjects({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      })
      .promise();
    if (response?.Errors?.length > 0) {
      throw new Error(
        `Failed to delete ${response.Errors.length} S3 object(s) under ${keys[0]}`
      );
    }
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
