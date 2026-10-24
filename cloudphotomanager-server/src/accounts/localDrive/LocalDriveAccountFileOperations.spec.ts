import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../../OTelContext";
import { AccountDefinition } from "../../model/AccountDefinition";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { LocalAccount } from "./LocalDriveAccount";

describe("LocalAccount file and folder operations", () => {
  let span: Span;
  let rootPath: string;
  let accountDefinition: AccountDefinition;
  let account: LocalAccount;

  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
    span = OTelTracer().startSpan("LocalDriveAccountFileOperations.spec");
  });

  beforeEach(async () => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-local-ops-"));
    accountDefinition = new AccountDefinition();
    accountDefinition.name = "local";
    accountDefinition.rootpath = rootPath;
    accountDefinition.info = { type: "localDrive" };
    accountDefinition.infoPrivate = {};
    account = new LocalAccount(accountDefinition);
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  afterAll(() => {
    span.end();
  });

  async function seedFile(
    folderpath: string,
    filename: string,
  ): Promise<File> {
    const folderDir = path.join(rootPath, folderpath);
    await fs.ensureDir(folderDir);
    const file = new File(accountDefinition.id, "folder-id", filename);
    file.idCloud = path.join(folderDir, filename);
    await fs.writeFile(file.idCloud, "content");
    return file;
  }

  it("moves a file into another folder", async () => {
    const file = await seedFile("a", "photo.jpg");
    await fs.ensureDir(path.join(rootPath, "b"));

    await account.moveFile(span, file, "/b");

    expect(fs.existsSync(path.join(rootPath, "b", "photo.jpg"))).toBe(true);
    expect(fs.existsSync(file.idCloud)).toBe(false);
  });

  it("moves a file to the account root", async () => {
    const file = await seedFile("a", "photo.jpg");

    await account.moveFile(span, file, "/");

    expect(fs.existsSync(path.join(rootPath, "photo.jpg"))).toBe(true);
    expect(fs.existsSync(file.idCloud)).toBe(false);
  });

  it("renames a file in place", async () => {
    const file = await seedFile("a", "photo.jpg");

    await account.renameFile(span, file, "renamed.jpg");

    expect(fs.existsSync(path.join(rootPath, "a", "renamed.jpg"))).toBe(true);
    expect(fs.existsSync(file.idCloud)).toBe(false);
  });

  it("refuses a move outside the account root", async () => {
    const file = await seedFile("a", "photo.jpg");

    await expect(account.moveFile(span, file, "/../outside")).rejects.toThrow(
      /Path outside account root/,
    );
    expect(fs.existsSync(file.idCloud)).toBe(true);
  });

  it("deletes a folder recursively while preserving siblings", async () => {
    await fs.ensureDir(path.join(rootPath, "2023", "sub"));
    await fs.writeFile(path.join(rootPath, "2023", "a.jpg"), "a");
    await fs.writeFile(path.join(rootPath, "2023", "sub", "b.jpg"), "b");
    await fs.ensureDir(path.join(rootPath, "2024"));
    await fs.writeFile(path.join(rootPath, "2024", "c.jpg"), "c");
    const folder = new Folder(accountDefinition.id, "/2023");
    folder.idCloud = path.join(rootPath, "2023");

    await account.deleteFolder(span, folder);

    expect(fs.existsSync(path.join(rootPath, "2023"))).toBe(false);
    expect(fs.existsSync(path.join(rootPath, "2024", "c.jpg"))).toBe(true);
  });

  it("renames a folder in place", async () => {
    const folder = new Folder(accountDefinition.id, "/2023");
    folder.idCloud = path.join(rootPath, "2023");
    await fs.ensureDir(path.join(folder.idCloud, "sub"));
    await fs.writeFile(path.join(folder.idCloud, "a.jpg"), "a");

    await account.renameFolder(span, folder, "2023-renamed");

    expect(fs.existsSync(path.join(rootPath, "2023-renamed", "a.jpg"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(rootPath, "2023-renamed", "sub"))).toBe(
      true,
    );
    expect(fs.existsSync(folder.idCloud)).toBe(false);
  });

  it("refuses to rename a folder outside the account root", async () => {
    const folder = new Folder(accountDefinition.id, "/2023");
    folder.idCloud = path.join(rootPath, "2023");
    await fs.ensureDir(folder.idCloud);

    await expect(
      account.renameFolder(span, folder, "../../escape"),
    ).rejects.toThrow(/Path outside account root/);
    expect(fs.existsSync(folder.idCloud)).toBe(true);
  });
});
