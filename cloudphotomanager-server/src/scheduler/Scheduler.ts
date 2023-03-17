import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountData } from "../accounts/AccountData";
import { AccountFactory } from "../accounts/AccountFactory";
import { Config } from "../Config";
import { AccountDefinition } from "../model/AccountDefinition";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";
import { SchedulerFiles } from "./SchedulerFiles";

let config: Config;

export class Scheduler {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    config = configIn;
    Scheduler.startSchedule();
    span.end();
  }

  public static async startSchedule() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const span = StandardTracer.startSpan("Scheduler_startSchedule");
      const accountDefinitions = await AccountData.list(span);
      accountDefinitions.forEach(async (accountDefinition) => {
        await Scheduler.processAccount(span, accountDefinition);
      });
      await Timeout.wait(config.SOURCE_FETCH_FREQUENCY);
    }
  }

  public static async processAccount(context: Span, accountDefinition: AccountDefinition) {
    const span = StandardTracer.startSpan("Scheduler_init", context);
    const account = await AccountFactory.getAccountImplementation(accountDefinition);
    // await SchedulerFiles.SyncFileInventory(span, account);
    await SchedulerFiles.SyncFileCache(span, account);
    // await SchedulerFiles.SyncFileMetadata(span, account);
    span.end();
  }
}
