import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { FolderDataRefreshCacheFolders } from "../folders/FolderData";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";

export async function AccountDataGet(
  context: Span,
  accountId: string
): Promise<AccountDefinition> {
  const span = StandardTracerStartSpan("AccountDataGet", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM accounts WHERE id = ? ",
    [accountId]
  );
  if (rawData.length === 0) {
    throw new Error("Account Not Found");
  }
  const account = fromRaw(rawData[0]);
  span.end();
  return account;
}

export async function AccountDataList(
  context: Span
): Promise<AccountDefinition[]> {
  const span = StandardTracerStartSpan("AccountDataList", context);
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
  accountDefinition: AccountDefinition
): Promise<void> {
  const span = StandardTracerStartSpan("AccountDataAdd", context);
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO accounts (id, name, rootpath, info, infoPrivate) VALUES (?, ?, ?, ?, ?)",
    [
      accountDefinition.id,
      accountDefinition.name,
      accountDefinition.rootpath,
      JSON.stringify(accountDefinition.info),
      JSON.stringify(accountDefinition.infoPrivate),
    ]
  );
  FolderDataRefreshCacheFolders(span);
  span.end();
}

export async function AccountDataUpdate(
  context: Span,
  accountDefinition: AccountDefinition
): Promise<void> {
  const span = StandardTracerStartSpan("AccountDataUpdate", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE accounts SET name=?, rootpath=?, info=?, infoPrivate=? WHERE id=?",
    [
      accountDefinition.name,
      accountDefinition.rootpath,
      JSON.stringify(accountDefinition.info),
      JSON.stringify(accountDefinition.infoPrivate),
      accountDefinition.id,
    ]
  );
  FolderDataRefreshCacheFolders(span);
  span.end();
}

export async function AccountDataDelete(
  context: Span,
  accountId: string
): Promise<void> {
  const span = StandardTracerStartSpan("AccountDataDelete", context);
  await SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE accountId = ?", [
    accountId,
  ]);
  await SqlDbUtilsExecSQL(span, "DELETE FROM accounts WHERE id = ?", [
    accountId,
  ]);
  span.end();
}

export async function AccountDataDeleteAllFilesAndFolders(
  context: Span,
  accountId: string
): Promise<void> {
  const span = StandardTracerStartSpan("AccountDataDeleteAllFiles", context);
  await SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE accountId = ?", [
    accountId,
  ]);
  await SqlDbUtilsExecSQL(span, "DELETE FROM folders WHERE accountId = ?", [
    accountId,
  ]);
  span.end();
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(accountRaw: any): AccountDefinition {
  const account = new AccountDefinition();
  account.id = accountRaw.id;
  account.name = accountRaw.name;
  account.rootpath = accountRaw.rootpath;
  account.info = JSON.parse(accountRaw.info);
  account.infoPrivate = JSON.parse(accountRaw.infoPrivate);
  return account;
}
