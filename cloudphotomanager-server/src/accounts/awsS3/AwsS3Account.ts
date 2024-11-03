import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import * as AWS from "aws-sdk";
import { StandardTracerStartSpan } from "../../utils-std-ts/StandardTracer";
import { S3 } from "aws-sdk";
import { File } from "../../model/File";
import * as fs from "fs-extra";
import { Folder } from "../../model/Folder";
import { AccountCapabilities } from "../../model/AccountCapabilities";
import {
  AwsS3AccountInventoryGetFolder,
  AwsS3AccountInventoryGetFolderByPath,
  AwsS3AccountInventoryListFoldersInFolder,
} from "./AwsS3AccountInventory";

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
  deleteFile(context: Span, file: File): Promise<void> {
    throw new Error("Method not implemented.");
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
  moveFile(context: Span, file: File, folderpathDestination: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  listFolders(context: Span): Promise<Folder[]> {
    throw new Error("Method not implemented.");
  }
  listFilesInFolder(context: Span, folder: Folder): Promise<File[]> {
    throw new Error("Method not implemented.");
  }
  updateFileMetadata(context: Span, file: File): Promise<void> {
    throw new Error("Method not implemented.");
  }
  downloadPreview(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  downloadThumbnail(context: Span, file: File, folder: string, filename: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public async downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void> {
    const span = StandardTracerStartSpan("AwsS3Account_downloadFile", context);
    const params = {
      Bucket: this.accountDefinition.infoPrivate.bucket + "bla",
      Key: `${file.folderId}/${file.filename}`,
    };
    const fileStream = (await this.getS3Client()).getObject(params).createReadStream();
    const writeStream = fs.createWriteStream(`${folder}/${filename}`);

    await new Promise((resolve, reject) => {
      fileStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
      fileStream.pipe(writeStream);
    });
    span.end();
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
}
