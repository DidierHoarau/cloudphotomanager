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
import { SyncQueueItemPriority } from "../model/SyncQueueItemPriority";

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

// Resolver functions for the promises that hold queue ops in flight during
// the tests; released in afterAll so no timer/handle survives the run and
// the jest worker can exit cleanly.
const mockPendingHolds: (() => void)[] = [];
function mockHoldPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    mockPendingHolds.push(resolve);
  });
}

// Folder re-syncs triggered for missing-in-cloud files must not actually run
// (and must not complete), so the queue row stays observable in assertions.
jest.mock("./SyncInventory", () => ({
  SyncInventorySyncFolder: jest.fn(() => mockHoldPromise()),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueueRow = any;

describe("SyncFileCache poison-file retry loop", () => {
  let span: Span;
  let config: Config;
  let dataDir: string;
  let tmpDir: string;
  let rootPath: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let syncFileCache: typeof import("./SyncFileCache");
  let syncQueue: typeof import("./SyncQueue");
  let syncFailures: typeof import("./SyncFailures");
  let fileData: typeof import("../files/FileData");
  let folderData: typeof import("../folders/FolderData");
  let accountData: typeof import("../accounts/AccountData");
  let accountFactory: typeof import("../accounts/AccountFactory");

  function queueRows(): QueueRow[] {
    return SqlDbUtilsQuerySQL(span, "SELECT * FROM sync_queue");
  }

  function rowsForFile(fileId: string): QueueRow[] {
    return queueRows().filter((row) => row.fileIds.includes(fileId));
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

  async function waitForQueueDrain(opId: string): Promise<void> {
    await waitUntil(`queue op ${opId} processed`, () =>
      queueRows().every((row) => row.id !== opId),
    );
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
    valid: boolean,
  ): Promise<File> {
    const file = new File(accountId, folder.id, filename);
    file.idCloud = path.join(folder.idCloud, filename);
    file.hash = "test-hash";
    file.dateSync = new Date();
    file.dateUpdated = new Date();
    file.dateMedia = new Date();
    if (valid) {
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
    } else {
      await fs.writeFile(file.idCloud, "this is not a valid image");
    }
    await fileData.FileDataAdd(span, file);
    return file;
  }

  function queueFileSyncOp(
    accountId: string,
    file: File,
    functionName: string,
  ): void {
    syncQueue.SyncQueueQueueItem(
      accountId,
      `test-op:${file.id}`,
      { fileId: file.id },
      functionName,
      SyncQueueItemPriority.NORMAL,
      [file.id],
    );
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-sync-spec-"));
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
    span = OTelTracer().startSpan("SyncFileCache.spec");

    await fs.ensureDir(dataDir);
    await fs.ensureDir(tmpDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    syncQueue = await import("./SyncQueue");
    syncFailures = await import("./SyncFailures");
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

    await syncFailures.SyncFailuresInit(span);
    await syncQueue.SyncQueueInit(span);
    await syncFileCache.SyncFileCacheInit(span, config);
    await fileData.FileDataInit(span, config);
    await folderData.FolderDataInit(span);
  });

  // Release every held queue op so its pending race/pool timers are cleared
  // and no handle keeps the jest worker alive after the suite finishes.
  afterAll(async () => {
    for (const release of mockPendingHolds.splice(0)) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it("records a SyncFailure and increments syncFailCount when a sync handler fails", async () => {
    const accountDefinition = await createAccount("acct-fail");
    const folder = await createFolder(accountDefinition.id, "photos-fail");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "remote.jpg",
      true,
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    jest
      .spyOn(account, "downloadFile")
      .mockRejectedValue(new Error("Download failed"));

    queueFileSyncOp(accountDefinition.id, file, "syncPhotoFromFull");
    await waitForQueueDrain(`test-op:${file.id}`);

    const failure = syncFailures
      .SyncFailuresList()
      .find(
        (f) =>
          f.functionName === "syncPhotoFromFull" &&
          f.fileIds.includes(file.id),
      );
    expect(failure).toBeDefined();
    expect(failure.kind).toBe("error");
    expect(failure.errorMessage).toContain("syncPhotoFromFull Failed");
    expect(failure.errorMessage).toContain("Download failed");

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated.syncFailCount).toBe(1);
    expect(updated.lastSyncError).toContain("syncPhotoFromFull Failed");
    expect(updated.lastSyncAttempt).toBeTruthy();
  });

  it("resets the failure counter after a successful sync", async () => {
    const accountDefinition = await createAccount("acct-ok");
    const folder = await createFolder(accountDefinition.id, "photos-ok");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "valid.jpg",
      true,
    );
    SqlDbUtilsExecSQL(
      span,
      "UPDATE files SET syncFailCount = 3, lastSyncError = 'older failure' WHERE id = ?",
      [file.id],
    );

    queueFileSyncOp(accountDefinition.id, file, "syncPhotoFromFull");
    await waitForQueueDrain(`test-op:${file.id}`);

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated.syncFailCount).toBe(0);
    expect(updated.lastSyncError).toBeNull();
    const cacheDir = await fileData.FileDataGetFileCacheDir(
      span,
      accountDefinition.id,
      file.id,
    );
    expect(fs.existsSync(path.join(cacheDir, "thumbnail.webp"))).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, "preview.webp"))).toBe(true);
  });

  it("queues a folder re-sync when the cloud download fails with 404", async () => {
    const accountDefinition = await createAccount("acct-404");
    const folder = await createFolder(accountDefinition.id, "photos-404");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "missing.jpg",
      true,
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    const notFoundError = new Error(
      "Request failed with status code 404",
    ) as Error & { response?: { status: number } };
    notFoundError.response = { status: 404 };
    jest.spyOn(account, "downloadFile").mockRejectedValue(notFoundError);

    queueFileSyncOp(accountDefinition.id, file, "syncPhotoFromFull");
    await waitForQueueDrain(`test-op:${file.id}`);

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated.syncFailCount).toBe(1);

    const failure = syncFailures
      .SyncFailuresList()
      .find(
        (f) =>
          f.functionName === "syncPhotoFromFull" &&
          f.fileIds.includes(file.id),
      );
    expect(failure).toBeDefined();
    expect(failure.errorMessage).toContain("404");

    const folderResyncRows = queueRows().filter(
      (row) => row.functionName === "SyncInventorySyncFolder",
    );
    expect(folderResyncRows).toHaveLength(1);
    expect(JSON.parse(folderResyncRows[0].data).folderId).toBe(folder.id);
  });

  it("records a SyncFailure when syncThumbnail fails", async () => {
    const accountDefinition = await createAccount("acct-thumb");
    const folder = await createFolder(accountDefinition.id, "photos-thumb");
    const file = await createImageFile(
      accountDefinition.id,
      folder,
      "thumb.jpg",
      true,
    );

    queueFileSyncOp(accountDefinition.id, file, "syncThumbnail");
    await waitForQueueDrain(`test-op:${file.id}`);

    const failure = syncFailures
      .SyncFailuresList()
      .find(
        (f) => f.functionName === "syncThumbnail" && f.fileIds.includes(file.id),
      );
    expect(failure).toBeDefined();
    expect(failure.kind).toBe("error");

    const updated = await fileData.FileDataGet(span, file.id);
    expect(updated.syncFailCount).toBe(1);

    expect(
      queueRows().some(
        (row) =>
          row.functionName === "SyncInventorySyncFolder" &&
          JSON.parse(row.data).folderId === folder.id,
      ),
    ).toBe(false);
  });

  it("skips auto re-queueing for files past the retry cap", async () => {
    const accountDefinition = await createAccount("acct-cap");
    const folder = await createFolder(accountDefinition.id, "photos-cap");
    const cappedFile = await createImageFile(
      accountDefinition.id,
      folder,
      "capped.jpg",
      true,
    );
    SqlDbUtilsExecSQL(span, "UPDATE files SET syncFailCount = 5 WHERE id = ?", [
      cappedFile.id,
    ]);
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    const file = await fileData.FileDataGet(span, cappedFile.id);
    expect(file.syncFailCount).toBe(5);

    await syncFileCache.SyncFileCacheCheckFile(span, account, file);

    expect(rowsForFile(cappedFile.id)).toHaveLength(0);
  });

  it("still queues work for files below the retry cap", async () => {
    const accountDefinition = await createAccount("acct-below");
    const folder = await createFolder(accountDefinition.id, "photos-below");
    const pendingFile = await createImageFile(
      accountDefinition.id,
      folder,
      "pending.jpg",
      true,
    );
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    // Hold the download in flight so the queue op stays ACTIVE; released in
    // afterAll so the pending op timers clear and the jest worker can exit.
    jest.spyOn(account, "downloadFile").mockImplementation(mockHoldPromise);

    await syncFileCache.SyncFileCacheCheckFile(span, account, pendingFile);

    // Let the queue dispatch and handler start before the test ends, so no
    // log output lands after the test has finished.
    await waitUntil("pending op dispatched", () =>
      rowsForFile(pendingFile.id).some((row) => row.status === "ACTIVE"),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const rows = rowsForFile(pendingFile.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.functionName === "syncPhotoFromFull")).toBe(
      true,
    );
  });

  it("daily check skips capped files but queues others", async () => {
    const accountDefinition = await createAccount("acct-daily");
    const folder = await createFolder(accountDefinition.id, "photos-daily");
    const cappedFile = await createImageFile(
      accountDefinition.id,
      folder,
      "daily-capped.jpg",
      true,
    );
    const pendingFile = await createImageFile(
      accountDefinition.id,
      folder,
      "daily-pending.jpg",
      true,
    );
    SqlDbUtilsExecSQL(span, "UPDATE files SET syncFailCount = 5 WHERE id = ?", [
      cappedFile.id,
    ]);
    const account =
      await accountFactory.AccountFactoryGetAccountImplementation(
        accountDefinition.id,
      );
    jest.spyOn(account, "downloadFile").mockImplementation(mockHoldPromise);

    await syncFileCache.SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
      span,
      accountDefinition.id,
    );

    // Let the queue dispatch and handler start before the test ends, so no
    // log output lands after the test has finished.
    await waitUntil("daily pending op dispatched", () =>
      rowsForFile(pendingFile.id).some((row) => row.status === "ACTIVE"),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(rowsForFile(cappedFile.id)).toHaveLength(0);
    const rowsForPending = rowsForFile(pendingFile.id);
    expect(rowsForPending.length).toBeGreaterThan(0);
  });
});
