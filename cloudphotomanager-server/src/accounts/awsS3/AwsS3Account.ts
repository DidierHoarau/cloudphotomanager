import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Span } from "@opentelemetry/sdk-trace-base";
import * as AWS from "aws-sdk";
import { StandardTracer } from "../../utils-std-ts/StandardTracer";
import { S3 } from "aws-sdk";
import { File } from "../../model/File";

export class AwsS3Account implements Account {
  //
  public static TYPE = "awsS3";

  private accountDefinition: AccountDefinition;
  private s3Client: S3;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  async listFiles(context: Span): Promise<File[]> {
    const span = StandardTracer.startSpan("AwsS3Account_listFiles", context);
    const params = {
      Bucket: this.accountDefinition.infoPrivate.bucket,
    };
    const files: File[] = [];
    const filesRaw = await (await this.getS3Client()).listObjectsV2(params).promise();
    filesRaw.Contents.forEach((fileRaw) => {
      const file = new File();
      file.accountId = this.accountDefinition.id;
      file.id = fileRaw.Key;
      file.idCloud = fileRaw.Key;
      file.hash = fileRaw.ETag;
      file.dateModified = new Date(fileRaw.LastModified);
      file.info.size = fileRaw.Size;
      files.push(file);
    });
    span.end();
    return files;
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
