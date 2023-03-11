import { Account } from "../../model/Account";
import { AccountDefinition } from "../../model/AccountDefinition";
import * as AWS from "aws-sdk";

export class AwsS3Account implements Account {
  //
  public static TYPE = "awsS3";

  private accountDefinition: AccountDefinition;

  constructor(accountDefinition: AccountDefinition) {
    this.accountDefinition = accountDefinition;
  }

  public async validate(account: AccountDefinition): Promise<boolean> {
    try {
      AWS.config.update({
        accessKeyId: account.infoPrivate.accessKey,
        secretAccessKey: account.infoPrivate.accessKeySecret,
        region: account.infoPrivate.region,
      });
      const s3 = new AWS.S3();
      const params = {
        Bucket: account.infoPrivate.bucket,
      };
      await s3.listObjectsV2(params).promise();
      return true;
    } catch (err) {
      return false;
    }
  }
}
