import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import * as AWS from "aws-sdk";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { S3 } from "aws-sdk";
import { File } from "../../model/File";
import { FileMediaType } from "../../model/FileMediaType";
import * as fs from "fs-extra";

export class AwsS3Account implements Account {
  //
  public static TYPE = "awsS3";

  private accountDefinition: AccountDefinition;
  private s3Client: S3;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  getAccountDefinition(): AccountDefinition {
    return this.accountDefinition;
  }

  async listFiles(context: Span): Promise<File[]> {
    const span = StandardTracer.startSpan("AwsS3Account_listFiles", context);
    const params = {
      Bucket: this.accountDefinition.infoPrivate.bucket,
    };
    const files: File[] = [];
    const filesRaw = await (await this.getS3Client()).listObjectsV2(params).promise();
    filesRaw.Contents.forEach((fileRaw) => {
      const mediaType = File.getMediaType(fileRaw.Key);
      if (mediaType === FileMediaType.image || mediaType === FileMediaType.video) {
        const file = new File();
        file.accountId = this.accountDefinition.id;
        file.idCloud = fileRaw.Key;
        file.filepath = fileRaw.Key;
        file.name = fileRaw.Key.split("/").pop();
        file.hash = fileRaw.ETag;
        file.dateModified = new Date(fileRaw.LastModified);
        file.info.size = fileRaw.Size;
        files.push(file);
      }
    });
    span.end();
    return files;
  }

  public async downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void> {
    const span = StandardTracer.startSpan("AwsS3Account_downloadFile", context);
    const params = {
      Bucket: this.accountDefinition.infoPrivate.bucket,
      Key: file.filepath,
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
    const span = StandardTracer.startSpan("AwsS3Account_validate", context);
    let valid = false;
    try {
      const params = {
        Bucket: this.accountDefinition.infoPrivate.bucket,
      };
      await (await this.getS3Client()).listObjectsV2(params).promise();
      valid = true;
    } catch (err) {
      span.recordException(err);
      console.log(err);
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
