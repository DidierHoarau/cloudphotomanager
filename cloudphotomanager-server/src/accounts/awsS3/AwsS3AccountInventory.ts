import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import * as path from "path";
import { Folder } from "../../model/Folder";
import { AwsS3Account } from "./AwsS3Account";

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
  const folder = new Folder(awsS3Account.getAccountDefinition().id, folderpath);
  folder.idCloud = path.join(awsS3Account.getAccountDefinition().rootpath + folderpath).replace(/^\/+/, "");
  folder.folderpath = folderpath;
  folder.dateSync = new Date();
  while (isTruncated) {
    const params = {
      Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
      Prefix: folder.idCloud,
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
      Prefix: folder.idCloud,
      ContinuationToken: continuationToken,
      Delimiter: "/",
    };

    const response = await s3.listObjectsV2(params).promise();
    for (const rawChildFolder of response.CommonPrefixes) {
      const subFolder = new Folder(
        awsS3Account.getAccountDefinition().id,
        path.join(folder.folderpath, rawChildFolder.Prefix)
      );
      subFolder.idCloud = path.join(folder.idCloud, rawChildFolder.Prefix);
      folders.push(subFolder);
    }
    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  return folders;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// function folderFromRaw(data: any, awsS3Account: AwsS3Account): Folder {
//   const folder = new Folder(
//     awsS3Account.getAccountDefinition().id
//     // awsS3Account.folderToDecodedRelative(`${data.parentReference.path}/${data.name}`)
//   );
//   folder.idCloud = data.id;
//   folder.dateSync = new Date();
//   folder.dateUpdated = new Date(data.lastModifiedDateTime);
//   return folder;
// }
