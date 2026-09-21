import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import sharp from "sharp";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import { AccountDefinition } from "../model/AccountDefinition";
import { File } from "../model/File";
import { Folder } from "../model/Folder";

jest.mock("uuid", () => ({
  v4: () => "uuid-" + Math.random().toString(36).slice(2, 12),
}));

// exifr leaks a FileHandle when parsing the test images, which crashes the
// jest worker at exit; EXIF extraction is not under test here.
jest.mock("exifr", () => ({
  parse: jest.fn().mockResolvedValue(null),
}));

// Avoid loading the heavy transformers.js dependency of AnalysisImages.
jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("SyncInventory folder reconciliation", () => {
  let span: Span;
  let config: Config;
  let dataDir: string;
  let tmpDir: string;
  let rootPath: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let syncInventory: typeof import("./SyncInventory");
  let syncQueue: typeof import("./SyncQueue");
  let syncFileCache: typeof import("./SyncFileCache");
  let fileData: typeof import("../files/FileData");
  let folderData: typeof import("../folders/FolderData");
  let accountData: typeof import("../accounts/AccountData");
  let accountFactory: typeof import("../accounts/AccountFactory");

  function queueRows(): any[] {
    return SqlDbUtilsQuerySQL(span, "SELECT * FROM sync_queue");
  }

  async function waitUntil(
    description: string,
    check: () => boolean,
    timeoutMs = 20000,
  ): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for: ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function waitForQueueDrainForFile(fileId: string): Promise<void> {
    await waitUntil(`queue drained for file ${fileId}`, () =>
      queueRows().every((row) => !row.fileIds.includes(fileId)),
    );
  }

  function sha256File(filePath: string): string {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
  }

  async function createAccount(name: string): Promise<AccountDefinition> {
    const accountDefinition = new AccountDefinition();
    accountDefinition.name = name;
    accountDefinition.rootpath = rootPath;
    accountDefinition.info = { type: "localDrive" };
    accountDefinition.infoPrivate = {};
    await accountData.AccountDataAdd(span, accountDefinition);
    return accountDefinition;
  }

  async function createFolder(
    accountId: string,
    folderpath: string,
  ): Promise<Folder> {
    const folder = new Folder(accountId, folderpath);
    folder.idCloud = path.join(rootPath, folderpath.replace(/^\//, ""));
    folder.dateSync = new Date();
    folder.dateUpdated = new Date();
    await fs.ensureDir(folder.idCloud);
    await folderData.FolderDataAdd(span, folder);
    return folder;
  }

  async function createImageFile(
    accountId: string,
    folder: Folder,
    filename: string,
  ): Promise<File> {
    const file = new File(accountId, folder.id, filename);
    file.idCloud = path.join(folder.idCloud, filename);
    file.dateSync = new Date();
    file.dateUpdated = new Date();
    file.dateMedia = new Date();
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg()
      .toFile(file.idCloud);
    // Match what the cloud listing reports: the content hash of the stored
    // file.
    file.hash = sha256File(file.idCloud);
    await fileData.FileDataAdd(span, file);
    return file;
  }

  async function cacheDirFor(
    accountId: string,
    fileId: string,
  ): Promise<string> {
    return fileData.FileDataGetFileCacheDir(span, accountId, fileId);
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-inventory-spec-"));
    dataDir = path.join(baseDir, "data");
    tmpDir = path.join(baseDir, "tmp");
    rootPath = path.join(baseDir, "cloud");
    // Set before the dynamic imports below: SyncQueue and SyncFailures read
    // DATA_DIR at module load time.
    process.env.DATA_DIR = dataDir;

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("SyncInventory.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(tmpDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    syncQueue = await import("./SyncQueue");
    syncInventory = await import("./SyncInventory");
    syncFileCache = await import("./SyncFileCache");
    fileData = await import("../files/FileData");
    folderData = await import("../folders/FolderData");
    accountData = await import("../accounts/AccountData");
    accountFactory = await import("../accounts/AccountFactory");

    config = {
      DATA_DIR: dataDir,
      TMP_DIR: tmpDir,
      TOOLS_DIR: path.join(baseDir, "tools"),
      IMAGE_CLASSIFICATION_ENABLED: false,
      VIDEO_PREVIEW_WIDTH: 900,
    } as unknown as Config;

    await syncQueue.SyncQueueInit(span);
    await syncFileCache.SyncFileCacheInit(span, config);
    await fileData.FileDataInit(span, config);
    await folderData.FolderDataInit(span);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it("repairs a stale cloud item reference on a name-matched file and keeps its cache", async () => {
    const accountDefinition = await createAccount("acct-repair");
    const folder = await createFolder(accountDefinition.id, "photos-repair");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "stale-ref.jpg",
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

    // Simulate a provider item whose reference changed while the file kept
    // the same name/path: the stored record points at an item that no
    // longer exists.
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET idCloud = 'stale-cloud-item-ref' WHERE id = ?",
      [file.id],
    );

    // Seed cache and keywords: same content, so nothing must be invalidated.
    const cacheDir = await cacheDirFor(accountDefinition.id, file.id);
    await fs.ensureDir(cacheDir);
    await fs.writeFile(path.join(cacheDir, "preview.webp"), "cached-preview");
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET keywords = 'existing keywords' WHERE id = ?",
      [file.id],
    );

    await syncInventory.SyncInventorySyncFolder(account, folder);

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated).not.toBeNull();
    expect(updated.idCloud).toBe(file.idCloud);
    expect(updated.hash).toBe(sha256File(file.idCloud));
    expect(updated.keywords).toBe("existing keywords");
    expect(fs.existsSync(path.join(cacheDir, "preview.webp"))).toBe(true);
    expect(queueRows().every((row) => !row.fileIds.includes(file.id))).toBe(
      true,
    );
  }, 20000);

  it("repairs a replaced cloud item and regenerates the invalidated cache", async () => {
    const accountDefinition = await createAccount("acct-replaced");
    const folder = await createFolder(accountDefinition.id, "photos-replaced");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "replaced.jpg",
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

    // Simulate the item being replaced in the cloud: new provider item
    // reference and new content, under the same name. Seed a stale hash,
    // stale cache files and a failure count past a few retries.
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET idCloud = 'stale-cloud-item-ref', hash = 'old-content-hash', keywords = 'old keywords', syncFailCount = 3, syncGone = 1 WHERE id = ?",
      [file.id],
    );
    const cacheDir = await cacheDirFor(accountDefinition.id, file.id);
    await fs.ensureDir(cacheDir);
    await fs.writeFile(path.join(cacheDir, "preview.webp"), "stale-preview");
    await fs.writeFile(path.join(cacheDir, "thumbnail.webp"), "stale-thumb");

    await syncInventory.SyncInventorySyncFolder(account, folder);

    // The record is refreshed and the stale cache/keywords/failures and the
    // gone tombstone are cleared.
    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated).not.toBeNull();
    expect(updated.idCloud).toBe(file.idCloud);
    expect(updated.hash).toBe(sha256File(file.idCloud));
    expect(updated.keywords).toBeNull();
    expect(updated.syncFailCount).toBe(0);
    expect(updated.syncGone).toBe(0);
    expect(fs.existsSync(path.join(cacheDir, "preview.webp"))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, "thumbnail.webp"))).toBe(false);

    // The cache check at the end of the sync re-queues preview generation,
    // which must succeed against the repaired cloud reference.
    await waitUntil("preview regenerated", () =>
      fs.existsSync(path.join(cacheDir, "preview.webp")),
    );
    await waitForQueueDrainForFile(file.id);
  }, 30000);

  it("deletes known files that are no longer in the cloud", async () => {
    const accountDefinition = await createAccount("acct-deleted");
    const folder = await createFolder(accountDefinition.id, "photos-deleted");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "gone.jpg",
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

    await fs.remove(file.idCloud);
    // Files tombstoned as gone must still be cleaned up by the folder sync
    // when they are absent from the cloud listing.
    SqlDbUtilsExecSQL(span, "UPDATE files SET syncGone = 1 WHERE id = ?", [
      file.id,
    ]);

    await syncInventory.SyncInventorySyncFolder(account, folder);

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated).toBeNull();
  }, 20000);

  it("clears a gone tombstone when the file is still present in the cloud", async () => {
    const accountDefinition = await createAccount("acct-falsegone");
    const folder = await createFolder(
      accountDefinition.id,
      "photos-falsegone",
    );
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "falsegone.jpg",
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

    SqlDbUtilsExecSQL(span, "UPDATE files SET syncGone = 1 WHERE id = ?", [
      file.id,
    ]);

    await syncInventory.SyncInventorySyncFolder(account, folder);

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated).not.toBeNull();
    expect(updated.syncGone).toBe(0);
    await waitForQueueDrainForFile(file.id);
  }, 20000);

  it("adds cloud files that are not known yet", async () => {
    const accountDefinition = await createAccount("acct-added");
    const folder = await createFolder(accountDefinition.id, "photos-added");
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );

    const filename = "added.jpg";
    const filePath = path.join(folder.idCloud, filename);
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .jpeg()
      .toFile(filePath);

    await syncInventory.SyncInventorySyncFolder(account, folder);

    const expectedId = new File(
      accountDefinition.id,
      folder.id,
      filename,
    ).id;
    const added = await fileData.FileDataGet(span, expectedId);
    expect(added).not.toBeNull();
    expect(added.filename).toBe(filename);
    expect(added.idCloud).toBe(filePath);
    expect(added.hash).toBe(sha256File(filePath));

    await waitForQueueDrainForFile(expectedId);
  }, 30000);
});
