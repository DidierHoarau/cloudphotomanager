import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { AccountDataAdd, AccountDataDelete, AccountDataGet } from "./AccountData";
import { FolderDataAdd, FolderDataGet } from "../folders/FolderData";
import { FileDataAdd, FileDataGet } from "../files/FileData";
import { ShareDataCreate } from "../shares/ShareData";
import { AccountDefinition } from "../model/AccountDefinition";
import { Folder } from "../model/Folder";
import { File } from "../model/File";

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("AccountDataDelete", () => {
  let span: Span;
  let baseDir: string;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  beforeAll(async () => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-account-data-"));
    dataDir = path.join(baseDir, "data");
    await fs.ensureDir(dataDir);

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("AccountData.spec");
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);
  });

  afterAll(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  function countRows(table: string, accountId: string): number {
    const rows = SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM ${table} WHERE accountId = ?`,
      [accountId],
    );
    return rows[0].count;
  }

  async function seedAccount(
    name: string,
  ): Promise<{ account: AccountDefinition; folder: Folder; file: File }> {
    const account = new AccountDefinition();
    account.name = name;
    account.rootpath = path.join(baseDir, "cloud", name);
    account.info = { type: "localDrive" };
    account.infoPrivate = {};
    await AccountDataAdd(span, account);

    const folder = new Folder(account.id, "/photos");
    folder.idCloud = path.join(account.rootpath, "photos");
    folder.dateSync = new Date();
    folder.dateUpdated = new Date();
    await FolderDataAdd(span, folder);

    const file = new File(account.id, folder.id, "photo.jpg");
    file.idCloud = path.join(folder.idCloud, "photo.jpg");
    file.hash = "hash";
    file.dateSync = new Date();
    file.dateUpdated = new Date();
    file.dateMedia = new Date();
    await FileDataAdd(span, file);

    await ShareDataCreate(span, account.id, folder.id);

    // Seed an account-owned cache subtree (plus a nested file).
    const cacheDir = path.join(dataDir, "cache", account.id, "a", "b");
    await fs.ensureDir(cacheDir);
    await fs.writeFile(path.join(cacheDir, "thumbnail.webp"), "cached");

    return { account, folder, file };
  }

  it("cascades files, folders, shares and the cache subtree of one account only", async () => {
    const target = await seedAccount("delete-me");
    const survivor = await seedAccount("keep-me");

    expect(countRows("shares", target.account.id)).toBe(1);

    await AccountDataDelete(span, target.account.id, dataDir);

    await expect(AccountDataGet(span, target.account.id)).rejects.toThrow(
      "Account Not Found",
    );
    expect(countRows("files", target.account.id)).toBe(0);
    expect(countRows("folders", target.account.id)).toBe(0);
    expect(countRows("shares", target.account.id)).toBe(0);
    expect(await FolderDataGet(span, target.folder.id)).toBeNull();
    expect(await FileDataGet(span, target.file.id)).toBeNull();
    expect(fs.existsSync(path.join(dataDir, "cache", target.account.id))).toBe(
      false,
    );

    // The other account and its cache are untouched.
    expect((await AccountDataGet(span, survivor.account.id)).name).toBe(
      "keep-me",
    );
    expect(countRows("files", survivor.account.id)).toBe(1);
    expect(countRows("folders", survivor.account.id)).toBe(1);
    expect(countRows("shares", survivor.account.id)).toBe(1);
    expect(
      fs.existsSync(path.join(dataDir, "cache", survivor.account.id)),
    ).toBe(true);
  });

  it("tolerates a missing cache directory", async () => {
    const account = await seedAccount("no-cache");
    await fs.remove(path.join(dataDir, "cache", account.account.id));

    await expect(
      AccountDataDelete(span, account.account.id, dataDir),
    ).resolves.toBeUndefined();
    expect(countRows("files", account.account.id)).toBe(0);
  });

  it("deletes the database rows when no dataDir is provided", async () => {
    const account = await seedAccount("no-data-dir");

    await expect(
      AccountDataDelete(span, account.account.id),
    ).resolves.toBeUndefined();
    expect(countRows("files", account.account.id)).toBe(0);
    // The cache directory is left in place when the caller did not provide
    // its location.
    expect(
      fs.existsSync(path.join(dataDir, "cache", account.account.id)),
    ).toBe(true);
  });
});
