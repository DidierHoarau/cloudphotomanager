import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../../OTelContext";
import { AccountDefinition } from "../../model/AccountDefinition";
import { LocalAccount } from "./LocalDriveAccount";
import {
  LocalAccountInventoryClearHashCache,
  LocalAccountInventoryGetFolderByPath,
  LocalAccountInventoryListFilesInFolder,
} from "./LocalDriveAccountInventory";

describe("LocalDriveAccountInventory hash cache", () => {
  let span: Span;
  let rootPath: string;

  function sha256(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  async function hashOf(account: LocalAccount, fileId: string): Promise<string> {
    const folder = await LocalAccountInventoryGetFolderByPath(
      span,
      account,
      "/",
    );
    const files = await LocalAccountInventoryListFilesInFolder(
      span,
      account,
      folder,
    );
    return files.find((file) => file.filename === fileId)?.hash;
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-localinv-"));
    rootPath = path.join(baseDir, "cloud");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    span = OTelTracer().startSpan("LocalDriveAccountInventory.spec");

    await fs.ensureDir(rootPath);
  });

  function makeAccount(): LocalAccount {
    const accountDefinition = new AccountDefinition();
    accountDefinition.id = "account-local-inventory";
    accountDefinition.name = "local-inventory";
    accountDefinition.rootpath = rootPath;
    accountDefinition.info = { type: "localDrive" };
    accountDefinition.infoPrivate = {};
    return new LocalAccount(accountDefinition);
  }

  it("hashes file content and reuses the (size, mtime) cache", async () => {
    LocalAccountInventoryClearHashCache();
    const account = makeAccount();
    const filePath = path.join(rootPath, "photo.jpg");
    const fixedMtime = new Date("2023-01-01T00:00:00.000Z");
    await fs.writeFile(filePath, "AAAA");
    await fs.utimes(filePath, fixedMtime, fixedMtime);

    const firstHash = await hashOf(account, "photo.jpg");
    expect(firstHash).toBe(sha256("AAAA"));

    // Same size, different content, same mtime: the cache entry still
    // matches (size, mtimeMs) and the inventory must not re-hash.
    await fs.writeFile(filePath, "BBBB");
    await fs.utimes(filePath, fixedMtime, fixedMtime);
    expect(await hashOf(account, "photo.jpg")).toBe(sha256("AAAA"));

    // Clearing the cache proves the previous hit came from the cache.
    LocalAccountInventoryClearHashCache();
    expect(await hashOf(account, "photo.jpg")).toBe(sha256("BBBB"));
  });

  it("re-hashes when the file size changes", async () => {
    LocalAccountInventoryClearHashCache();
    const account = makeAccount();
    const filePath = path.join(rootPath, "growing.jpg");
    await fs.writeFile(filePath, "CCCC");
    expect(await hashOf(account, "growing.jpg")).toBe(sha256("CCCC"));

    await fs.appendFile(filePath, "D");
    expect(await hashOf(account, "growing.jpg")).toBe(sha256("CCCCD"));
  });

  it("re-hashes when the modification time changes", async () => {
    LocalAccountInventoryClearHashCache();
    const account = makeAccount();
    const filePath = path.join(rootPath, "touched.jpg");
    const earlier = new Date("2023-01-01T00:00:00.000Z");
    await fs.writeFile(filePath, "EEEE");
    await fs.utimes(filePath, earlier, earlier);
    expect(await hashOf(account, "touched.jpg")).toBe(sha256("EEEE"));

    // Same size, new content, explicit mtime change.
    await fs.writeFile(filePath, "FFFF");
    const later = new Date("2023-01-01T00:05:00.000Z");
    await fs.utimes(filePath, later, later);
    expect(await hashOf(account, "touched.jpg")).toBe(sha256("FFFF"));
  });
});
