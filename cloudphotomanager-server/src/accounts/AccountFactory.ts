import { Account } from "../model/Account";
import { AccountDefinition } from "../model/AccountDefinition";
import { AwsS3Account } from "./awsS3/AwsS3Account";

export class AccountFactory {
  public static async getAccountImplementation(accountDefinition: AccountDefinition): Promise<Account> {
    if (accountDefinition.info.type === AwsS3Account.TYPE) {
      return new AwsS3Account(accountDefinition);
    }
    throw new Error("Account Implementation Not Found");
  }
}
