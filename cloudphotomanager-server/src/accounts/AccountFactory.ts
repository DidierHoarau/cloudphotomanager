import { Account } from "../model/Account";
import { AccountDefinition } from "../model/AccountDefinition";
import { AwsS3Account } from "./awsS3/AwsS3Account";
import { OneDriveAccount } from "./awsS3/OneDriveAccount";

export class AccountFactory {
  public static async getAccountImplementation(accountDefinition: AccountDefinition): Promise<Account> {
    if (accountDefinition.info.type === AwsS3Account.TYPE) {
      return new AwsS3Account(accountDefinition);
    } else if (accountDefinition.info.type === OneDriveAccount.TYPE) {
      return new OneDriveAccount(accountDefinition);
    }
    throw new Error("Account Implementation Not Found");
  }
}
