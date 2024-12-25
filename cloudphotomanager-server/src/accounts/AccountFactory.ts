import { Account } from "../model/Account";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { AccountDataGet } from "./AccountData";
import { AwsS3Account } from "./awsS3/AwsS3Account";
import { LocalAccount } from "./localDrive/LocalDriveAccount";
import { OneDriveAccount } from "./oneDrive/OneDriveAccount";
import * as _ from "lodash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accounts: any[] = [];

export async function AccountFactoryGetAccountFromDefinition(accountDefinition: AccountDefinition): Promise<Account> {
  switch (accountDefinition.info.type) {
    case AwsS3Account.TYPE: {
      return new AwsS3Account(accountDefinition);
    }
    case OneDriveAccount.TYPE: {
      return new OneDriveAccount(accountDefinition);
    }
    case LocalAccount.TYPE: {
      return new LocalAccount(accountDefinition);
    }
    default: {
      throw new Error("Account Implementation Not Found");
    }
  }
}

export async function AccountFactoryGetAccountImplementation(id: string): Promise<Account> {
  const cached = _.find(accounts, { id });
  if (cached) {
    return cached.account;
  }

  const span = StandardTracerStartSpan("AccountFactory_getAccountImplementation");
  const accountDefinition = await AccountDataGet(span, id);
  let account;

  switch (accountDefinition.info.type) {
    case AwsS3Account.TYPE: {
      account = new AwsS3Account(accountDefinition);
      break;
    }
    case OneDriveAccount.TYPE: {
      account = new OneDriveAccount(accountDefinition);
      break;
    }
    case LocalAccount.TYPE: {
      account = new LocalAccount(accountDefinition);
      break;
    }
    default: {
      account = null;
    }
  }
  span.end();
  if (!account) {
    throw new Error("Account Implementation Not Found");
  }
  accounts.push({ id, account });
  return account;
}
