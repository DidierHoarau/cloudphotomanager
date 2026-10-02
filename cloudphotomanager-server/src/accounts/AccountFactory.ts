import { find } from "lodash";
import { Account } from "../model/Account";
import { AccountDefinition } from "../model/AccountDefinition";
import { OTelTracer } from "../OTelContext";
import { AccountDataGet } from "./AccountData";
import { AwsS3Account } from "./awsS3/AwsS3Account";
import { LocalAccount } from "./localDrive/LocalDriveAccount";
import { OneDriveAccount } from "./oneDrive/OneDriveAccount";

const accounts: any[] = [];

// Drops the cached account implementation after an account was added,
// updated or deleted, so it is rebuilt from the database on next use.
export function AccountFactoryInvalidate(accountId: string): void {
  const index = accounts.findIndex((entry) => entry.id === accountId);
  if (index >= 0) {
    accounts.splice(index, 1);
  }
}

export async function AccountFactoryGetAccountFromDefinition(
  accountDefinition: AccountDefinition
): Promise<Account> {
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

export async function AccountFactoryGetAccountImplementation(
  id: string
): Promise<Account> {
  const cached = find(accounts, { id });
  if (cached) {
    return cached.account;
  }

  const span = OTelTracer().startSpan(
    "AccountFactory_getAccountImplementation"
  );
  try {
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
    if (!account) {
      throw new Error("Account Implementation Not Found");
    }
    accounts.push({ id, account });
    return account;
  } finally {
    span.end();
  }
}
