import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDefinition } from "../model/AccountDefinition";
import { FolderDataRefreshCacheFolders } from "../folders/FolderData";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { AccountFactoryInvalidate } from "./AccountFactory";
import * as fs from "fs-extra";
import * as path from "path";

const logger = OTelLogger().createModuleLogger("AccountData");

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
  dataDir?: string,
): Promise<void> {
  const span = OTelTracer().startSpan("AccountDataDelete", context);
  try {
    // Shares, files, folders and the account row are removed atomically: a
    // failure must not leave orphans behind (shares pointing to deleted
    // folders, files without an account, ...).
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(span, "DELETE FROM shares WHERE accountId = ?", [
        accountId,
      ]);
      SqlDbUtilsExecSQL(span, "DELETE FROM files WHERE accountId = ?", [
        accountId,
      ]);
      SqlDbUtilsExecSQL(span, "DELETE FROM folders WHERE accountId = ?", [
        accountId,
      ]);
      SqlDbUtilsExecSQL(span, "DELETE FROM accounts WHERE id = ?", [
        accountId,
      ]);
    });
    apply();
    if (dataDir) {
      // Best effort: a cache cleanup failure must not fail the deletion.
      try {
        await fs.rm(path.join(dataDir, "cache", accountId), {
          recursive: true,
          force: true,
        });
      } catch (err) {
        logger.error(
          `Error removing cache directory for account ${accountId}`,
          err,
          span,
        );
      }
    }
  } finally {
    AccountFactoryInvalidate(accountId);
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
