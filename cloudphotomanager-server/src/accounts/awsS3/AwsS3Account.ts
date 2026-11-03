import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Span } from "@opentelemetry/sdk-trace";
import { Account } from "../../model/Account";
import { AccountCapabilities } from "../../model/AccountCapabilities";
import { AccountDefinition } from "../../model/AccountDefinition";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { OTelTracer } from "../../OTelContext";
import {
  AwsS3AccountFileOperationsDeleteFile,
  AwsS3AccountFileOperationsDownloadFile,
  AwsS3AccountFileOperationsMoveFile,
  AwsS3AccountFileOperationsRenameFile,
} from "./AwsS3AccountFileOperations";
import {
  AwsS3AccountFolderOperationsDeleteFolder,
  AwsS3AccountFolderOperationsRenameFolder,
} from "./AwsS3AccountFolderOperations";
import {
  AwsS3AccountInventoryGetFolder,
  AwsS3AccountInventoryGetFolderByPath,
  AwsS3AccountInventoryListFilesInFolder,
  AwsS3AccountInventoryListFoldersInFolder,
} from "./AwsS3AccountInventory";

export class AwsS3Account implements Account {
  //
  public static TYPE = "awsS3";

  private accountDefinition: AccountDefinition;
  private s3Client: S3Client;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  getCapabilities(): AccountCapabilities {
    return {
      downloadFileOriginal: true,
      downloadPhotoThumbnail: false,
      downloadPhotoPreview: false,
      downloadVideoThumbnail: false,
      downloadVideoPreview: false,
    };
  }

  async deleteFile(context: Span, file: File): Promise<void> {
    await AwsS3AccountFileOperationsDeleteFile(
      context,
      this,
      await this.getS3Client(),
      file,
    );
  }

  async listFoldersInFolder(context: Span, folder: Folder): Promise<Folder[]> {
    return AwsS3AccountInventoryListFoldersInFolder(
      context,
      this,
      await this.getS3Client(),
      folder,
    );
  }

  async getFolder(context: Span, folder: Folder): Promise<Folder> {
    return AwsS3AccountInventoryGetFolder(
      context,
      this,
      await this.getS3Client(),
      folder,
    );
  }

  async getFolderByPath(context: Span, folderpath: string): Promise<Folder> {
    return AwsS3AccountInventoryGetFolderByPath(
      context,
      this,
      await this.getS3Client(),
      folderpath,
    );
  }

  async moveFile(
    context: Span,
    file: File,
    folderpathDestination: string,
  ): Promise<void> {
    await AwsS3AccountFileOperationsMoveFile(
      context,
      this,
      await this.getS3Client(),
      file,
      folderpathDestination,
    );
  }

  async listFilesInFolder(context: Span, folder: Folder): Promise<File[]> {
    return AwsS3AccountInventoryListFilesInFolder(
      context,
      this,
      await this.getS3Client(),
      folder,
    );
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  public async downloadFile(
    context: Span,
    file: File,
    destinationFolderpath: string,
    destinationFilename: string,
  ): Promise<void> {
    await AwsS3AccountFileOperationsDownloadFile(
      context,
      this,
      await this.getS3Client(),
      file,
      destinationFolderpath,
      destinationFilename,
    );
  }

  public async validate(context: Span): Promise<boolean> {
    const span = OTelTracer().startSpan("AwsS3Account_validate", context);
    let valid = false;
    try {
      const params = {
        Bucket: this.accountDefinition.infoPrivate.bucket,
      };
      await (await this.getS3Client()).send(new ListObjectsV2Command(params));
      valid = true;
    } catch (err) {
      span.recordException(err);
    }
    span.end();
    return valid;
  }

  async renameFile(context: Span, file: File, filename: string): Promise<void> {
    await AwsS3AccountFileOperationsRenameFile(
      context,
      this,
      await this.getS3Client(),
      file,
      filename,
    );
  }

  private async getS3Client(): Promise<S3Client> {
    if (this.s3Client) {
      return this.s3Client;
    }
    this.s3Client = new S3Client({
      region: this.accountDefinition.infoPrivate.region,
      credentials: {
        accessKeyId: this.accountDefinition.infoPrivate.accessKey,
        secretAccessKey: this.accountDefinition.infoPrivate.accessKeySecret,
      },
      // v2 sent no checksum headers; keep the request shape identical for
      // S3-compatible providers.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return this.s3Client;
  }

  // Non Supported Features

  updateFileMetadata(_context: Span, _file: File): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadPreview(
    _context: Span,
    _file: File,
    _folder: string,
    _filename: string,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  downloadThumbnail(
    _context: Span,
    _file: File,
    _folder: string,
    _filename: string,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  listFolders(_context: Span): Promise<Folder[]> {
    throw new Error("Method not implemented.");
  }

  async deleteFolder(context: Span, folder: Folder): Promise<void> {
    await AwsS3AccountFolderOperationsDeleteFolder(
      context,
      this,
      await this.getS3Client(),
      folder,
    );
  }

  async renameFolder(
    context: Span,
    folder: Folder,
    newName: string,
  ): Promise<void> {
    await AwsS3AccountFolderOperationsRenameFolder(
      context,
      this,
      await this.getS3Client(),
      folder,
      newName,
    );
  }
}
