import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDefinition } from "../model/AccountDefinition";
import { FolderDataRefreshCacheFolders } from "../folders/FolderData";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { AccountFactoryInvalidate } from "./AccountFactory";

export async function AccountDataGet(
  context: Span,
  accountId: string,
): Promise<AccountDefinition> {
  const span = OTelTracer().startSpan("AccountDataGet", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM accounts WHERE id = ? ",
      [accountId],
    );
    if (rawData.length === 0) {
      throw new Error("Account Not Found");
    }
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function AccountDataList(
  context: Span,
): Promise<AccountDefinition[]> {
  const span = OTelTracer().startSpan("AccountDataList", context);
  const rawData = await SqlDbUtilsQuerySQL(span, "SELECT * FROM accounts");
  const accounts: AccountDefinition[] = [];
  for (const account of rawData) {
    accounts.push(fromRaw(account));
  }
  span.end();
  return accounts;
}

export async function AccountDataAdd(
  context: Span,
  accountDefinition: AccountDefinition,
): Promise<void> {
  const span = OTelTracer().startSpan("AccountDataAdd", context);
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO accounts (id, name, rootpath, info, infoPrivate) VALUES (?, ?, ?, ?, ?)",
    [
      accountDefinition.id,
      accountDefinition.name,
      accountDefinition.rootpath,
      JSON.stringify(accountDefinition.info),
      JSON.stringify(accountDefinition.infoPrivate),
    ],
  );
  AccountFactoryInvalidate(accountDefinition.id);
  FolderDataRefreshCacheFolders(span);
  span.end();
}

export async function AccountDataUpdate(
  context: Span,
  accountDefinition: AccountDefinition,
): Promise<void> {
  const span = OTelTracer().startSpan("AccountDataUpdate", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE accounts SET name=?, rootpath=?, info=?, infoPrivate=? WHERE id=?",
    [
      accountDefinition.name,
      accountDefinition.rootpath,
      JSON.stringify(accountDefinition.info),
      JSON.stringify(accountDefinition.infoPrivate),
      accountDefinition.id,
    ],
  );
  AccountFactoryInvalidate(accountDefinition.id);
  FolderDataRefreshCacheFolders(span);
  span.end();
}

export async function AccountDataDelete(
  context: Span,
  accountId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("AccountDataDelete", context);
  try {
    // Files and account row are removed atomically: a failure must not leave
    // orphaned files behind.
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE accountId = ?", [
        accountId,
      ]);
      SqlDbUtilsExecSQL(span, "DELETE FROM accounts WHERE id = ?", [
        accountId,
      ]);
    });
    apply();
  } finally {
    AccountFactoryInvalidate(accountId);
    FolderDataRefreshCacheFolders(span);
    span.end();
  }
}

export async function AccountDataDeleteAllFilesAndFolders(
  context: Span,
  accountId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("AccountDataDeleteAllFiles", context);
  try {
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE accountId = ?", [
        accountId,
      ]);
      SqlDbUtilsExecSQL(span, "DELETE FROM folders WHERE accountId = ?", [
        accountId,
      ]);
    });
    apply();
  } finally {
    FolderDataRefreshCacheFolders(span);
    span.end();
  }
}

// Private Functions

function fromRaw(accountRaw: any): AccountDefinition {
  const account = new AccountDefinition();
  account.id = accountRaw.id;
  account.name = accountRaw.name;
  account.rootpath = accountRaw.rootpath;
  account.info = JSON.parse(accountRaw.info);
  account.infoPrivate = JSON.parse(accountRaw.infoPrivate);
  return account;
}
