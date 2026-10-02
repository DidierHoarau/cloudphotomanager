import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { AccountDefinition } from "../model/AccountDefinition";
import { LocalAccount } from "./localDrive/LocalDriveAccount";

describe("AccountFactory", () => {
  let span: Span;
  let dataDir: string;
  let rootPath: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let accountFactory: typeof import("./AccountFactory");
  let accountData: typeof import("./AccountData");

  function makeAccountDefinition(name: string): AccountDefinition {
    const accountDefinition = new AccountDefinition();
    accountDefinition.name = name;
    accountDefinition.rootpath = rootPath;
    accountDefinition.info = { type: "localDrive" };
    accountDefinition.infoPrivate = {};
    return accountDefinition;
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-factory-spec-"));
    dataDir = path.join(baseDir, "data");
    rootPath = path.join(baseDir, "cloud");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("AccountFactory.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(rootPath);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    accountFactory = await import("./AccountFactory");
    accountData = await import("./AccountData");
  });

  it("builds and caches the account implementation", async () => {
    const accountDefinition = makeAccountDefinition("factory-cached");
    await accountData.AccountDataAdd(span, accountDefinition);

    const first =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    expect(first).toBeInstanceOf(LocalAccount);
    expect(first.getAccountDefinition().name).toBe("factory-cached");

    const second =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    expect(second).toBe(first);
  });

  it("returns the updated definition after an account update without a restart", async () => {
    const accountDefinition = makeAccountDefinition("before-update");
    await accountData.AccountDataAdd(span, accountDefinition);
    const before = await accountFactory.AccountFactoryGetAccountImplementation(
      accountDefinition.id,
    );
    expect(before.getAccountDefinition().name).toBe("before-update");

    accountDefinition.name = "after-update";
    await accountData.AccountDataUpdate(span, accountDefinition);

    const after = await accountFactory.AccountFactoryGetAccountImplementation(
      accountDefinition.id,
    );
    expect(after.getAccountDefinition().name).toBe("after-update");
    expect(after).not.toBe(before);
  });

  it("drops the cached implementation when the account is deleted", async () => {
    const accountDefinition = makeAccountDefinition("to-delete");
    await accountData.AccountDataAdd(span, accountDefinition);
    await accountFactory.AccountFactoryGetAccountImplementation(
      accountDefinition.id,
    );

    await accountData.AccountDataDelete(span, accountDefinition.id);

    await expect(
      accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      ),
    ).rejects.toThrow("Account Not Found");
  });
});
