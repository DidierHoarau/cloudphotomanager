import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import * as path from "path";
import { Folder } from "../../model/Folder";
import { AwsS3Account } from "./AwsS3Account";

export async function AwsS3AccountInventoryGetFolderByPath(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  folderpath: string
): Promise<Folder> {
  let isTruncated = true;
  let continuationToken;
  const folderPath = path.join(awsS3Account.getAccountDefinition().rootpath + folderpath).replace(/^\/+/, "");
  // const folder = new Folder(awsS3Account.getAccountDefinition().id, folderPath);

  while (isTruncated) {
    const params = {
      Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
      Prefix: folderPath,
      ContinuationToken: continuationToken,
      Delimiter: "/",
    };

    const response = await s3.listObjectsV2(params).promise();
    response.Contents.forEach((item) => {
      // console.log(item.Key);
      // console.log(item);
    });
    response.CommonPrefixes.forEach((prefix) => {
      console.log(prefix.Prefix);
    });

    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  // return folderFromRaw()
  throw new Error("Method not implemented.");
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
