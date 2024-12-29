import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import * as AWS from "aws-sdk";
import { StandardTracerStartSpan } from "../../utils-std-ts/StandardTracer";
import { S3 } from "aws-sdk";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { AccountCapabilities } from "../../model/AccountCapabilities";
import {
  AwsS3AccountInventoryGetFolder,
  AwsS3AccountInventoryGetFolderByPath,
  AwsS3AccountInventoryListFilesInFolder,
  AwsS3AccountInventoryListFoldersInFolder,
} from "./AwsS3AccountInventory";
import {
  AwsS3AccountFileOperationsDeleteFile,
  AwsS3AccountFileOperationsDownloadFile,
  AwsS3AccountFileOperationsMoveFile,
} from "./AwsS3AccountFileOperations";

export class AwsS3Account implements Account {
  //
  public static TYPE = "awsS3";

  private accountDefinition: AccountDefinition;
  private s3Client: S3;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  getCapabilities(): AccountCapabilities {
    return {
      downloadPhotoThumbnail: false,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: false,
      downloadVideoPreview: false,
    };
  }

  async deleteFile(context: Span, file: File): Promise<void> {
    await AwsS3AccountFileOperationsDeleteFile(context, this, await this.getS3Client(), file);
  }

  async listFoldersInFolder(context: Span, folder: Folder): Promise<Folder[]> {
    return AwsS3AccountInventoryListFoldersInFolder(context, this, await this.getS3Client(), folder);
  }

  async getFolder(context: Span, folder: Folder): Promise<Folder> {
    return AwsS3AccountInventoryGetFolder(context, this, await this.getS3Client(), folder);
  }

  async getFolderByPath(context: Span, folderpath: string): Promise<Folder> {
    return AwsS3AccountInventoryGetFolderByPath(context, this, await this.getS3Client(), folderpath);
  }

  async moveFile(context: Span, file: File, folderpathDestination: string): Promise<void> {
    await AwsS3AccountFileOperationsMoveFile(context, this, await this.getS3Client(), file, folderpathDestination);
  }

  async listFilesInFolder(context: Span, folder: Folder): Promise<File[]> {
    return AwsS3AccountInventoryListFilesInFolder(context, this, await this.getS3Client(), folder);
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string
  ): Promise<void> {
    await AwsS3AccountFileOperationsDownloadFile(
      context,
      this,
      await this.getS3Client(),
      file,
      destinationFolderpath,
      destinationFilename
    );
  }

  public async validate(context: Span): Promise<boolean> {
    const span = StandardTracerStartSpan("AwsS3Account_validate", context);
    let valid = false;
    try {
      const params = {
        Bucket: this.accountDefinition.infoPrivate.bucket,
      };
      await (await this.getS3Client()).listObjectsV2(params).promise();
      valid = true;
    } catch (err) {
      span.recordException(err);
    }
    span.end();
    return valid;
  }

  async renameFile(context: Span, file: File, filename: string): Promise<void> {
    await AwsS3AccountFileOperationsMoveFile(context, this, await this.getS3Client(), file, filename);
  }

  private async getS3Client(): Promise<S3> {
    if (this.s3Client) {
      return this.s3Client;
    }
    AWS.config.update({
      accessKeyId: this.accountDefinition.infoPrivate.accessKey,
      secretAccessKey: this.accountDefinition.infoPrivate.accessKeySecret,
      region: this.accountDefinition.infoPrivate.region,
    });
    return new AWS.S3();
  }

  // Non Supported Features

  updateFileMetadata(context: Span, file: File): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadPreview(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadThumbnail(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  listFolders(context: Span): Promise<Folder[]> {
    throw new Error("Method not implemented.");
  }

  deleteFolder(context: Span, folder: Folder): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
