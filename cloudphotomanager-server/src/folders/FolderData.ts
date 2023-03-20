import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import * as path from "path";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { Config } from "../Config";
import { Folder } from "../model/Folder";

let config: Config;

export class FolderData {
  //
  public static async init(context: Span, configIn: Config) {
    const span = StandardTracer.startSpan("FolderData_init", context);
    config = configIn;
    span.end();
  }

  public static async deleteAccount(context: Span, accountId: string): Promise<void> {
    const span = StandardTracer.startSpan("FolderData_deleteAccount", context);
    await SqlDbutils.execSQL(span, "DELETE FROM folders WHERE accountId = ? ", [accountId]);
    await SqlDbutils.execSQL(span, "DELETE FROM files WHERE accountId = ? ", [accountId]);
    span.end();
  }

  public static async add(context: Span, folder: Folder): Promise<void> {
    const span = StandardTracer.startSpan("FolderData_add", context);
    await SqlDbutils.execSQL(
      span,
      "INSERT INTO folders (id, idCloud, accountId, folderpath, dateUpdated, dateSync, info) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ",
      [
        folder.id,
        folder.idCloud,
        folder.accountId,
        folder.folderpath,
        folder.dateUpdated.toISOString(),
        folder.dateSync.toISOString(),
        JSON.stringify(folder.info),
      ]
    );
    span.end();
  }

  public static async get(context: Span, accountId: string, id: string): Promise<Folder> {
    const span = StandardTracer.startSpan("FolderData_get", context);
    const folderRaw = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? AND  id = ?", [
      accountId,
      id,
    ]);
    if (folderRaw.length === 0) {
      return null;
    }
    return fromRaw(folderRaw[0]);
  }

  public static async update(context: Span, folder: Folder) {
    const span = StandardTracer.startSpan("FolderData_update", context);
    await SqlDbutils.execSQL(span, "UPDATE folders SET dateUpdated=?, dateSync=?, info=? WHERE id=? AND accountId=? ", [
      folder.dateUpdated.toISOString(),
      folder.dateSync.toISOString(),
      JSON.stringify(folder.info),
      folder.id,
      folder.accountId,
    ]);
    span.end();
  }

  public static async getByCloudId(context: Span, accountId: string, idCloud: string): Promise<Folder> {
    const span = StandardTracer.startSpan("FolderData_getByCloudId", context);
    const folderRaw = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? AND idCloud = ?", [
      accountId,
      idCloud,
    ]);
    if (folderRaw.length === 0) {
      return null;
    }
    return fromRaw(folderRaw[0]);
  }

  public static async listByParentFolder(context: Span, accountId: string, parentFolder: Folder): Promise<Folder[]> {
    const span = StandardTracer.startSpan("FolderData_listByParentFolder", context);
    const accountfolders = await FolderData.listForAccount(span, accountId);
    const folders = [];
    accountfolders.forEach((candidateFolder) => {
      if (
        candidateFolder.folderpath.indexOf(parentFolder.folderpath) === 0 &&
        candidateFolder.folderpath.split("/").length === candidateFolder.folderpath.split("/").length + 1
      ) {
        folders.push(fromRaw(candidateFolder));
      }
    });
    span.end();
    return folders;
  }

  public static async listForAccount(context: Span, accountId: string): Promise<Folder[]> {
    const span = StandardTracer.startSpan("FolderData_listForAccount", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? ORDER BY folderpath ", [
      accountId,
    ]);
    const folders = [];
    rawData.forEach((folderRaw) => {
      folders.push(fromRaw(folderRaw));
    });
    span.end();
    return folders;
  }

  public static async deleteForAccount(context: Span, accountId: string, folderpath: string): Promise<void> {
    const span = StandardTracer.startSpan("FolderData_listForAccount", context);
    await SqlDbutils.execSQL(span, "DELETE FROM files WHERE accountId = ? AND folderpath = ?", [accountId, folderpath]);
    span.end();
  }

  public static async getOlderThan(context: Span, accountId: string, ageLimit: Date): Promise<Folder[]> {
    const span = StandardTracer.startSpan("FolderData_getOlderThan", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM folders WHERE accountId = ? AND dateSync < ? ", [
      accountId,
      ageLimit.toISOString(),
    ]);
    const folders = [];
    rawData.forEach((folderRaw) => {
      folders.push(fromRaw(folderRaw));
    });
    span.end();
    return folders;
  }

  public static async deletePathRecursive(context: Span, accountId: string, folderpath: string) {
    const span = StandardTracer.startSpan("FolderData_deletePathRecursive", context);
    await SqlDbutils.execSQL(
      span,
      "DELETE FROM files " +
        " WHERE accountId = ? " +
        ` AND folderId IN ( SELECT id FROM folders WHERE accountId = ? AND folderpath LIKE '${folderpath}%' ) `,
      [accountId, accountId]
    );
    await SqlDbutils.execSQL(span, `DELETE FROM folders WHERE accountId = ? AND folderpath LIKE '${folderpath}%' `, [
      accountId,
    ]);
    span.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(folderRaw: any): Folder {
  const folder = new Folder();
  folder.id = folderRaw.id;
  folder.idCloud = folderRaw.idCloud;
  folder.folderpath = folderRaw.folderpath;
  folder.accountId = folderRaw.accountId;
  folder.dateSync = new Date(folderRaw.dateSync);
  folder.dateUpdated = new Date(folderRaw.dateUpdated);
  folder.info = folderRaw.info;
  return folder;
}
