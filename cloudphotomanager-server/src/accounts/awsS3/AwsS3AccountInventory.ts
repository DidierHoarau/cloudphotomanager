import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import * as path from "path";
import { Folder } from "../../model/Folder";
import { AwsS3Account } from "./AwsS3Account";
import { File } from "../../model/File";

const dateEmptyFolder = new Date("1900-01-01 00:00:00");

export async function AwsS3AccountInventoryGetFolder(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folder: Folder
): Promise<Folder> {
  return AwsS3AccountInventoryGetFolderByPath(context, awsS3Account, s3, folder.idCloud);
}

export async function AwsS3AccountInventoryGetFolderByPath(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folderpath: string
): Promise<Folder> {
  let isTruncated = true;
  let continuationToken;
  folderpath = folderpath.replace(/\/$/, "");
  const folder = new Folder(awsS3Account.getAccountDefinition().id, folderpath);
  folder.idCloud = path.join(awsS3Account.getAccountDefinition().rootpath, folderpath).replace(/^\/+/, "");
  folder.folderpath = toApplicationPath(awsS3Account.getAccountDefinition().rootpath, folderpath);
  folder.dateSync = new Date();
  folder.dateUpdated = dateEmptyFolder;
  while (isTruncated) {
    const params = {
      Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
      Prefix: toAwsFolderPath(folder.idCloud),
      ContinuationToken: continuationToken,
      Delimiter: "/",
    };

    const response = await s3.listObjectsV2(params).promise();
    response.Contents.forEach((item) => {
      if (!folder.dateUpdated || folder.dateUpdated < new Date(item.LastModified))
        folder.dateUpdated = new Date(item.LastModified);
    });
    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  return folder;
}

export async function AwsS3AccountInventoryListFoldersInFolder(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folder: Folder
): Promise<Folder[]> {
  const folders: Folder[] = [];
  let isTruncated = true;
  let continuationToken;
  while (isTruncated) {
    const params = {
      Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
      Prefix: toAwsFolderPath(folder.idCloud),
      ContinuationToken: continuationToken,
      Delimiter: "/",
    };

    const response = await s3.listObjectsV2(params).promise();
    for (const rawChildFolder of response.CommonPrefixes) {
      const subFolder = await AwsS3AccountInventoryGetFolderByPath(context, awsS3Account, s3, rawChildFolder.Prefix);
      folders.push(subFolder);
    }
    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  return folders;
}

export async function AwsS3AccountInventoryListFilesInFolder(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folder: Folder
): Promise<File[]> {
  const files: File[] = [];
  let isTruncated = true;
  let continuationToken;
  while (isTruncated) {
    const params = {
      Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
      Prefix: toAwsFolderPath(folder.idCloud),
      ContinuationToken: continuationToken,
      Delimiter: "/",
    };

    const response = await s3.listObjectsV2(params).promise();
    response.Contents.forEach((item) => {
      if (item.Key !== folder.folderpath && !item.Key.endsWith("/")) {
        const file = new File(awsS3Account.getAccountDefinition().id, folder.id, path.basename(item.Key));
        file.dateSync = new Date();
        file.dateUpdated = new Date(item.LastModified);
        file.idCloud = item.Key;
        files.push(file);
      }
    });

    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  return files;
}

// Private Function

function toAwsFolderPath(pathInput: string): string {
  if (pathInput === "/" || pathInput === "") {
    return "";
  }
  pathInput = pathInput.startsWith("/") ? pathInput.slice(1) : pathInput;
  return pathInput.endsWith("/") ? pathInput : pathInput + "/";
}

function toApplicationPath(accountRoot: string, pathInput: string): string {
  if (pathInput === "/" || pathInput === "") {
    return "/";
  }
  pathInput = pathInput.startsWith("/") ? pathInput : "/" + pathInput;
  return pathInput;
}
