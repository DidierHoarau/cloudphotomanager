import { Span } from "@opentelemetry/sdk-trace-base";
import { S3 } from "aws-sdk";
import { createWriteStream } from "fs";
import * as path from "path";
import { File } from "../../model/File";
import { OTelTracer } from "../../OTelContext";
import { AwsS3Account } from "./AwsS3Account";

export async function AwsS3AccountFileOperationsDownloadFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
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
  const fileStream = s3.getObject(params).createReadStream();
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
  s3: S3,
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
  await s3.deleteObject(params).promise();
  span.end();
}

export async function AwsS3AccountFileOperationsMoveFile(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  file: File,
  filename: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsMoveFile",
    context
  );
  const paramsCopy = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    CopySource: encodeURI(
      path.join(
        "/",
        awsS3Account.getAccountDefinition().infoPrivate.bucket,
        file.idCloud
      )
    ),
    Key: toAwsFilePath(path.join(path.dirname(file.idCloud), filename)),
  };
  await s3.copyObject(paramsCopy).promise();
  const paramsDelete = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  await s3.deleteObject(paramsDelete).promise();
  span.end();
}

export async function AwsS3AccountFileOperationsRename(
  context: Span,
  awsS3Account: AwsS3Account,
  s3: S3,
  file: File,
  folderpathDestination: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AwsS3AccountFileOperationsMoveFile",
    context
  );
  const paramsCopy = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    CopySource: encodeURI(
      path.join(
        "/",
        awsS3Account.getAccountDefinition().infoPrivate.bucket,
        file.idCloud
      )
    ),
    Key: toAwsFilePath(
      path.join(
        awsS3Account.getAccountDefinition().rootpath,
        folderpathDestination,
        file.filename
      )
    ),
  };
  await s3.copyObject(paramsCopy).promise();
  const paramsDelete = {
    Bucket: awsS3Account.getAccountDefinition().infoPrivate.bucket,
    Key: file.idCloud,
  };
  await s3.deleteObject(paramsDelete).promise();
  span.end();
}

// Private Fucntions

function toAwsFilePath(pathInput: string): string {
  pathInput = pathInput.startsWith("/") ? pathInput.slice(1) : pathInput;
  return pathInput;
}
