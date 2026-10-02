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
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { Folder } from "../model/Folder";

describe("FolderData", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");
  const accountId = "account-folderdata-spec";

  let folderData: typeof import("./FolderData");

  async function createFolder(
    folderpath: string,
    dateUpdated = new Date(),
  ): Promise<Folder> {
    const folder = new Folder(accountId, folderpath);
    folder.idCloud = `/cloud${folderpath}`;
    folder.dateSync = new Date();
    folder.dateUpdated = dateUpdated;
    await folderData.FolderDataAdd(span, folder);
    return folder;
  }

  function insertFileRow(folderId: string, fileId: string): void {
    const now = new Date().toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO files (id, idCloud, accountId, filename, folderId, hash, dateUpdated, dateSync, dateMedia, info, metadata) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        fileId,
        `cloud/${fileId}`,
        accountId,
        `${fileId}.jpg`,
        folderId,
        `hash-${fileId}`,
        now,
        now,
        now,
        "{}",
        "{}",
      ],
    );
  }

  function folderpaths(): string[] {
    return SqlDbUtilsQuerySQL(
      span,
      "SELECT folderpath FROM folders WHERE accountId = ? ORDER BY folderpath",
      [accountId],
    ).map((row: any) => row.folderpath);
  }

  function fileIds(): string[] {
    return SqlDbUtilsQuerySQL(
      span,
      "SELECT id FROM files WHERE accountId = ? ORDER BY id",
      [accountId],
    ).map((row: any) => row.id);
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-folders-spec-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("FolderData.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    folderData = await import("./FolderData");
  });

  it("FolderDataDeletePathRecursive deletes the exact path and its subtree only", async () => {
    const year2023 = await createFolder("/2023");
    const year2023Sub = await createFolder("/2023/sub");
    const backup = await createFolder("/2023-backup");
    const backupSub = await createFolder("/2023-backup/sub");
    const other = await createFolder("/other");
    insertFileRow(year2023.id, "f-2023");
    insertFileRow(year2023Sub.id, "f-2023-sub");
    insertFileRow(backup.id, "f-backup");
    insertFileRow(backupSub.id, "f-backup-sub");
    insertFileRow(other.id, "f-other");

    await folderData.FolderDataDeletePathRecursive(span, accountId, "/2023");

    expect(folderpaths()).toEqual([
      "/2023-backup",
      "/2023-backup/sub",
      "/other",
    ]);
    expect(fileIds()).toEqual(["f-backup", "f-backup-sub", "f-other"]);
    expect(year2023.id).toBeTruthy();
    expect(backup.id).toBeTruthy();
  });

  it("treats LIKE wildcards in folder paths as literals", async () => {
    // A fresh account so the assertions are self-contained.
    const wildcardAccountId = "account-folderdata-wildcards";
    const percentFolder = new Folder(wildcardAccountId, "/100%_real");
    percentFolder.idCloud = "/cloud/100%_real";
    percentFolder.dateSync = new Date();
    percentFolder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, percentFolder);
    const nearMatchFolder = new Folder(wildcardAccountId, "/100Xreal");
    nearMatchFolder.idCloud = "/cloud/100Xreal";
    nearMatchFolder.dateSync = new Date();
    nearMatchFolder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, nearMatchFolder);

    await folderData.FolderDataDeletePathRecursive(
      span,
      wildcardAccountId,
      "/100%_real",
    );

    // Without escaping, "%"_" would match "100Xreal" as well.
    const remaining = SqlDbUtilsQuerySQL(
      span,
      "SELECT folderpath FROM folders WHERE accountId = ? ORDER BY folderpath",
      [wildcardAccountId],
    ).map((row: any) => row.folderpath);
    expect(remaining).toEqual(["/100Xreal"]);
  });

  it("deletes every folder and file of the account for the root path", async () => {
    await folderData.FolderDataDeletePathRecursive(span, accountId, "/");
    expect(folderpaths()).toEqual([]);
    expect(fileIds()).toEqual([]);
  });

  it("FolderDataAdd replaces an existing row atomically", async () => {
    const first = await createFolder(
      "/replace-me",
      new Date("2020-01-01T00:00:00.000Z"),
    );
    const updatedDate = new Date("2021-01-01T00:00:00.000Z");
    const replacement = new Folder(accountId, "/replace-me");
    replacement.id = first.id;
    replacement.idCloud = "/cloud/replaced";
    replacement.dateSync = updatedDate;
    replacement.dateUpdated = updatedDate;
    await folderData.FolderDataAdd(span, replacement);

    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND folderpath = '/replace-me'",
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].idCloud).toBe("/cloud/replaced");
    expect(new Date(rows[0].dateUpdated).toISOString()).toBe(
      updatedDate.toISOString(),
    );
  });

  it("rolls back the delete when the insert of FolderDataAdd fails", async () => {
    const existing = await createFolder("/keep-on-error");
    const broken = new Folder(accountId, "/keep-on-error");
    broken.id = existing.id;
    broken.idCloud = "/cloud/keep-on-error";
    broken.dateSync = new Date();
    // The INSERT serializes dateUpdated: an invalid value throws after the
    // DELETE already ran, and the transaction must restore the old row.
    broken.dateUpdated = undefined;

    await expect(folderData.FolderDataAdd(span, broken)).rejects.toBeDefined();

    const rows = SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM folders WHERE accountId = ? AND id = ?",
      [accountId, existing.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].idCloud).toBe("/cloud/keep-on-error");
  });
});
