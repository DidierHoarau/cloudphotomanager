import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";

export class AccountData {
  //
  public static async get(context: Span, accountId: string): Promise<AccountDefinition> {
    const span = StandardTracer.startSpan("AccountData_get", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM accounts WHERE id = ? ", [accountId]);
    if (rawData.length === 0) {
      throw new Error("Account Not Found");
    }
    const account = fromRaw(rawData[0]);
    span.end();
    return account;
  }

  public static async list(context: Span): Promise<AccountDefinition[]> {
    const span = StandardTracer.startSpan("AccountData_list", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM accounts");
    const accounts: AccountDefinition[] = [];
    if (rawData.length > 0) {
      accounts.push(fromRaw(rawData[0]));
    }
    span.end();
    return accounts;
  }

  public static async add(context: Span, accountDefinition: AccountDefinition): Promise<void> {
    const span = StandardTracer.startSpan("AccountData_add", context);
    await SqlDbutils.execSQL(span, "INSERT INTO accounts (id, name, info, infoPrivate) VALUES (?, ?, ?, ?)", [
      accountDefinition.id,
      accountDefinition.name,
      JSON.stringify(accountDefinition.info),
      JSON.stringify(accountDefinition.infoPrivate),
    ]);
    span.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(accountRaw: any): AccountDefinition {
  const account = new AccountDefinition();
  account.id = accountRaw.id;
  account.name = accountRaw.name;
  account.info = JSON.parse(accountRaw.info);
  account.infoPrivate = JSON.parse(accountRaw.infoPrivate);
  return account;
}
