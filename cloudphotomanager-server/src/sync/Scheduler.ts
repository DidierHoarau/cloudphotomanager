import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";
import { SyncFileCache } from "./SyncFileCache";
import { SyncFileMetadata } from "./SyncFileMetadata";
import { SyncInventory } from "./SyncInventory";

let config: Config;

export class Scheduler {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    SyncFileCache.init(span, configIn);
    SyncFileMetadata.init(span, configIn);
    SyncInventory.init(span, configIn);
    Scheduler.startSchedule();
    span.end();
  }

  public static async startSchedule() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const span = StandardTracer.startSpan("Scheduler_startSchedule");
      const accountDefinitions = await AccountData.list(span);
      accountDefinitions.forEach(async (accountDefinition) => {
        Scheduler.startAccountSync(span, accountDefinition);
      });
      await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
    }
  }

  public static async startAccountSync(context: Span, accountDefinition: AccountDefinition) {
    const span = StandardTracer.startSpan("Scheduler_startAccountSync", context);
    const account = await AccountFactory.getAccountImplementation(accountDefinition);
    await SyncInventory.startSync(span, account);
    await SyncFileMetadata.startSync(span, account);
    SyncFileCache.startSync(span, account);
    span.end();
  }
}