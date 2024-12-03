import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import * as path from "path";
import { AwsS3Account } from "./AwsS3Account";
import { File } from "../../model/File";
import { StandardTracerStartSpan } from "../../utils-std-ts/StandardTracer";
import { createWriteStream } from "fs";

export async function AwsS3AccountFileOperationsDownloadFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  file: File,
  destinationFolderpath: string,
  destinationFilename: string
): Promise<void> {
  const span = StandardTracerStartSpan("AwsS3AccountFileOperationsDownloadFile", context);
  const params = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  const fileStream = s3.getObject(params).createReadStream();
  const writeStream = createWriteStream(path.join(destinationFolderpath, destinationFilename));
  await new Promise((resolve, reject) => {
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
  s3: S3,
  file: File
): Promise<void> {
  const span = StandardTracerStartSpan("AwsS3AccountFileOperationsDownloadFile", context);

  const params = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  await s3.deleteObject(params).promise();
  span.end();
}
