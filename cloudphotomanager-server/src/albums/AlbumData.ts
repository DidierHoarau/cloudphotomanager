import { Span } from "@opentelemetry/sdk-trace";
import { Album, ALBUM_MAX_ITEMS } from "../model/Album";
import { File } from "../model/File";
import { OTelTracer } from "../OTelContext";
import { FileDataFromRaw } from "../files/FileData";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

export interface AlbumListEntry {
  album: Album;
  itemCount: number;
  coverFile: File | null;
}

export interface AlbumStats {
  count: number;
  size: number;
}

function folderFilterSql(permittedFolderIds: string[] | null): string {
  return permittedFolderIds === null
    ? ""
    : " AND f.folderId IN (SELECT value FROM json_each(?)) ";
}

function folderFilterParam(
  permittedFolderIds: string[] | null,
): string | null {
  return permittedFolderIds === null
    ? null
    : JSON.stringify(permittedFolderIds);
}

export async function AlbumDataCreate(
  context: Span,
  album: Album,
): Promise<void> {
  const span = OTelTracer().startSpan("AlbumData_create", context);
  try {
    await SqlDbUtilsExecSQL(
      span,
      "INSERT INTO albums (id, accountId, name, coverFileId, orderMode, ownerUserId, dateCreated, dateUpdated, info) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        album.id,
        album.accountId,
        album.name,
        album.coverFileId,
        album.orderMode,
        album.ownerUserId,
        album.dateCreated.toISOString(),
        album.dateUpdated.toISOString(),
        JSON.stringify(album.info),
      ],
    );
  } finally {
    span.end();
  }
}

export async function AlbumDataGet(
  context: Span,
  albumId: string,
): Promise<Album> {
  const span = OTelTracer().startSpan("AlbumData_get", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM albums WHERE id = ?",
      [albumId],
    );
    if (rawData.length === 0) {
      return null;
    }
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function AlbumDataUpdate(
  context: Span,
  album: Album,
): Promise<void> {
  const span = OTelTracer().startSpan("AlbumData_update", context);
  try {
    album.dateUpdated = new Date();
    await SqlDbUtilsExecSQL(
      span,
      "UPDATE albums SET name = ?, coverFileId = ?, orderMode = ?, dateUpdated = ?, info = ? WHERE id = ?",
      [
        album.name,
        album.coverFileId,
        album.orderMode,
        album.dateUpdated.toISOString(),
        JSON.stringify(album.info),
        album.id,
      ],
    );
  } finally {
    span.end();
  }
}

export async function AlbumDataTouch(context: Span, albumId: string) {
  const span = OTelTracer().startSpan("AlbumData_touch", context);
  try {
    await SqlDbUtilsExecSQL(
      span,
      "UPDATE albums SET dateUpdated = ? WHERE id = ?",
      [new Date().toISOString(), albumId],
    );
  } finally {
    span.end();
  }
}

// Deletes the album with its item memberships and its album-scoped shares;
// the referenced files stay in their folders.
export async function AlbumDataDelete(
  context: Span,
  albumId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("AlbumData_delete", context);
  try {
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      SqlDbUtilsExecSQL(span, "DELETE FROM album_items WHERE albumId = ?", [
        albumId,
      ]);
      SqlDbUtilsExecSQL(
        span,
        "DELETE FROM shares WHERE scope = 'album' AND albumId = ?",
        [albumId],
      );
      SqlDbUtilsExecSQL(span, "DELETE FROM albums WHERE id = ?", [albumId]);
    });
    apply();
  } finally {
    span.end();
  }
}

// Albums of an account with the number of items the user may see. Non-admin
// users only see albums they own or that contain at least one granted file;
// counts and covers are filtered the same way (folder grants still apply
// inside an album).
export async function AlbumDataListForAccount(
  context: Span,
  accountId: string,
  userId: string,
  isAdmin: boolean,
  permittedFolderIds: string[] | null,
): Promise<AlbumListEntry[]> {
  const span = OTelTracer().startSpan("AlbumData_listForAccount", context);
  try {
    const filter = folderFilterSql(permittedFolderIds);
    const filterParam = folderFilterParam(permittedFolderIds);
    const params: any[] = [accountId];
    if (filterParam !== null) {
      params.push(filterParam);
    }
    params.push(accountId);
    let ownershipCondition = "";
    if (!isAdmin) {
      ownershipCondition = " AND (a.ownerUserId = ? OR COALESCE(c.itemCount, 0) > 0) ";
      params.push(userId);
    }
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT a.*, COALESCE(c.itemCount, 0) AS itemCount FROM albums a " +
        "LEFT JOIN (" +
        "  SELECT ai.albumId AS albumId, COUNT(*) AS itemCount " +
        "  FROM album_items ai JOIN files f ON f.id = ai.fileId " +
        "  WHERE f.accountId = ? AND COALESCE(f.trashed, 0) = 0" +
        filter +
        "  GROUP BY ai.albumId" +
        ") c ON c.albumId = a.id " +
        "WHERE a.accountId = ?" +
        ownershipCondition +
        "ORDER BY a.dateUpdated DESC, a.id DESC",
      params,
    );
    const entries: AlbumListEntry[] = [];
    for (const row of rawData) {
      const album = fromRaw(row);
      const coverFile = await coverFileFor(
        span,
        album,
        accountId,
        permittedFolderIds,
      );
      entries.push({
        album,
        itemCount: Number(row.itemCount) || 0,
        coverFile,
      });
    }
    return entries;
  } finally {
    span.end();
  }
}

// Count/size of what the user may see inside an album (trashed files and
// ungranted folders excluded).
export async function AlbumDataStats(
  context: Span,
  albumId: string,
  accountId: string,
  permittedFolderIds: string[] | null,
): Promise<AlbumStats> {
  const span = OTelTracer().startSpan("AlbumData_stats", context);
  try {
    const filter = folderFilterSql(permittedFolderIds);
    const params: any[] = [albumId, accountId];
    const filterParam = folderFilterParam(permittedFolderIds);
    if (filterParam !== null) {
      params.push(filterParam);
    }
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) AS count, COALESCE(SUM(CAST(json_extract(f.info, '$.size') AS INTEGER)), 0) AS size " +
        "FROM album_items ai JOIN files f ON f.id = ai.fileId " +
        "WHERE ai.albumId = ? AND f.accountId = ? AND COALESCE(f.trashed, 0) = 0" +
        filter,
      params,
    );
    if (rows.length === 0) {
      return { count: 0, size: 0 };
    }
    return {
      count: Number(rows[0].count) || 0,
      size: Number(rows[0].size) || 0,
    };
  } finally {
    span.end();
  }
}

// Number of distinct memberships, regardless of visibility (cap enforcement
// and ownership checks run outside the grant filter).
export async function AlbumDataItemCount(
  context: Span,
  albumId: string,
): Promise<number> {
  const span = OTelTracer().startSpan("AlbumData_itemCount", context);
  try {
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) AS count FROM album_items WHERE albumId = ?",
      [albumId],
    );
    return rows.length > 0 ? Number(rows[0].count) || 0 : 0;
  } finally {
    span.end();
  }
}

export async function AlbumDataItemIsMember(
  context: Span,
  albumId: string,
  fileId: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("AlbumData_itemIsMember", context);
  try {
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT 1 FROM album_items WHERE albumId = ? AND fileId = ?",
      [albumId, fileId],
    );
    return rows.length > 0;
  } finally {
    span.end();
  }
}

export async function AlbumDataItemsListPaginated(
  context: Span,
  albumId: string,
  accountId: string,
  orderMode: "capture" | "manual",
  sortOrder: "asc" | "desc",
  page: number,
  pageSize: number,
  permittedFolderIds: string[] | null,
): Promise<{ files: File[]; total: number }> {
  const span = OTelTracer().startSpan("AlbumData_itemsList", context);
  try {
    const filter = folderFilterSql(permittedFolderIds);
    const filterParam = folderFilterParam(permittedFolderIds);
    const baseParams: any[] = [albumId, accountId];
    if (filterParam !== null) {
      baseParams.push(filterParam);
    }
    const where =
      "FROM album_items ai JOIN files f ON f.id = ai.fileId " +
      "WHERE ai.albumId = ? AND f.accountId = ? AND COALESCE(f.trashed, 0) = 0" +
      filter;
    const countRows = await SqlDbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) AS count ${where}`,
      baseParams,
    );
    const total = countRows.length > 0 ? Number(countRows[0].count) || 0 : 0;
    const order =
      orderMode === "manual"
        ? "ORDER BY ai.position ASC, f.id ASC"
        : `ORDER BY f.dateMedia ${sortOrder === "asc" ? "ASC" : "DESC"}, f.id ${sortOrder === "asc" ? "ASC" : "DESC"}`;
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      `SELECT f.* ${where} ${order} LIMIT ? OFFSET ?`,
      [...baseParams, pageSize, page * pageSize],
    );
    return { files: rawData.map((row) => FileDataFromRaw(row)), total };
  } finally {
    span.end();
  }
}

// All visible member ids in their effective order (used to switch to manual
// ordering and to validate cover/move targets).
export async function AlbumDataItemsOrderedIds(
  context: Span,
  albumId: string,
  accountId: string,
  orderMode: "capture" | "manual",
  permittedFolderIds: string[] | null,
): Promise<string[]> {
  const span = OTelTracer().startSpan("AlbumData_itemsOrderedIds", context);
  try {
    const filter = folderFilterSql(permittedFolderIds);
    const filterParam = folderFilterParam(permittedFolderIds);
    const params: any[] = [albumId, accountId];
    if (filterParam !== null) {
      params.push(filterParam);
    }
    const order =
      orderMode === "manual"
        ? "ORDER BY ai.position ASC, f.id ASC"
        : "ORDER BY f.dateMedia DESC, f.id ASC";
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT ai.fileId AS fileId FROM album_items ai JOIN files f ON f.id = ai.fileId " +
        "WHERE ai.albumId = ? AND f.accountId = ? AND COALESCE(f.trashed, 0) = 0" +
        filter +
        " " +
        order,
      params,
    );
    return rows.map((row) => row.fileId);
  } finally {
    span.end();
  }
}

// Adds every file id atomically; ids already in the album are left untouched.
// Positions append after the current maximum so capture ordering survives
// until the user switches to manual ordering.
export async function AlbumDataItemsAdd(
  context: Span,
  albumId: string,
  fileIds: string[],
): Promise<number> {
  const span = OTelTracer().startSpan("AlbumData_itemsAdd", context);
  try {
    const uniqueIds = Array.from(new Set(fileIds));
    if (uniqueIds.length === 0) {
      return 0;
    }
    const maxRows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COALESCE(MAX(position), 0) AS maxPosition FROM album_items WHERE albumId = ?",
      [albumId],
    );
    let position =
      maxRows.length > 0 ? Number(maxRows[0].maxPosition) || 0 : 0;
    const now = new Date().toISOString();
    let added = 0;
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      for (const fileId of uniqueIds) {
        position += 1;
        added += SqlDbUtilsExecSQL(
          span,
          "INSERT INTO album_items (albumId, fileId, position, dateAdded) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (albumId, fileId) DO NOTHING",
          [albumId, fileId, position, now],
        );
      }
    });
    apply();
    if (added > 0) {
      await AlbumDataTouch(span, albumId);
    }
    return added;
  } finally {
    span.end();
  }
}

export async function AlbumDataItemsRemove(
  context: Span,
  albumId: string,
  fileIds: string[],
): Promise<number> {
  const span = OTelTracer().startSpan("AlbumData_itemsRemove", context);
  try {
    const uniqueIds = Array.from(new Set(fileIds));
    if (uniqueIds.length === 0) {
      return 0;
    }
    let removed = 0;
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      for (const fileId of uniqueIds) {
        removed += SqlDbUtilsExecSQL(
          span,
          "DELETE FROM album_items WHERE albumId = ? AND fileId = ?",
          [albumId, fileId],
        );
        SqlDbUtilsExecSQL(
          span,
          "UPDATE albums SET coverFileId = NULL, dateUpdated = ? WHERE id = ? AND coverFileId = ?",
          [new Date().toISOString(), albumId, fileId],
        );
      }
    });
    apply();
    if (removed > 0) {
      await AlbumDataTouch(span, albumId);
    }
    return removed;
  } finally {
    span.end();
  }
}

// Moves one item one step earlier/later in the current effective order,
// renumbers the whole album and switches it to manual ordering. Returns false
// when the item is not a visible member or is already at the edge.
export async function AlbumDataItemsMove(
  context: Span,
  albumId: string,
  accountId: string,
  orderMode: "capture" | "manual",
  fileId: string,
  direction: "earlier" | "later",
  permittedFolderIds: string[] | null,
): Promise<boolean> {
  const span = OTelTracer().startSpan("AlbumData_itemsMove", context);
  try {
    const ordered = await AlbumDataItemsOrderedIds(
      span,
      albumId,
      accountId,
      orderMode,
      permittedFolderIds,
    );
    const index = ordered.indexOf(fileId);
    if (index < 0) {
      return false;
    }
    const target = direction === "earlier" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) {
      return false;
    }
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const now = new Date().toISOString();
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      for (let i = 0; i < ordered.length; i++) {
        SqlDbUtilsExecSQL(
          span,
          "UPDATE album_items SET position = ? WHERE albumId = ? AND fileId = ?",
          [i + 1, albumId, ordered[i]],
        );
      }
      SqlDbUtilsExecSQL(
        span,
        "UPDATE albums SET orderMode = 'manual', dateUpdated = ? WHERE id = ?",
        [now, albumId],
      );
    });
    apply();
    return true;
  } finally {
    span.end();
  }
}

export { ALBUM_MAX_ITEMS };

// Number of requested ids that are not members yet (cap accounting for adds).
export async function AlbumDataNewItemCount(
  context: Span,
  albumId: string,
  fileIds: string[],
): Promise<number> {
  const span = OTelTracer().startSpan("AlbumData_newItemCount", context);
  try {
    const uniqueIds = Array.from(new Set(fileIds));
    if (uniqueIds.length === 0) {
      return 0;
    }
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) AS count FROM album_items WHERE albumId = ? AND fileId IN (SELECT value FROM json_each(?))",
      [albumId, JSON.stringify(uniqueIds)],
    );
    const existing = rows.length > 0 ? Number(rows[0].count) || 0 : 0;
    return uniqueIds.length - existing;
  } finally {
    span.end();
  }
}

// Switches an album to manual ordering, numbering all non-trashed members by
// the order currently displayed (capture date, newest first).
export async function AlbumDataSetOrderModeManual(
  context: Span,
  albumId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("AlbumData_orderModeManual", context);
  try {
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT ai.fileId AS fileId FROM album_items ai JOIN files f ON f.id = ai.fileId " +
        "WHERE ai.albumId = ? AND COALESCE(f.trashed, 0) = 0 " +
        "ORDER BY f.dateMedia DESC, f.id ASC",
      [albumId],
    );
    const now = new Date().toISOString();
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        SqlDbUtilsExecSQL(
          span,
          "UPDATE album_items SET position = ? WHERE albumId = ? AND fileId = ?",
          [i + 1, albumId, rows[i].fileId],
        );
      }
      SqlDbUtilsExecSQL(
        span,
        "UPDATE albums SET orderMode = 'manual', dateUpdated = ? WHERE id = ?",
        [now, albumId],
      );
    });
    apply();
  } finally {
    span.end();
  }
}

export async function AlbumDataCoverFile(
  context: Span,
  album: Album,
  permittedFolderIds: string[] | null,
): Promise<File | null> {
  const span = OTelTracer().startSpan("AlbumData_coverFile", context);
  try {
    return coverFileFor(span, album, album.accountId, permittedFolderIds);
  } finally {
    span.end();
  }
}

// Private Functions

async function coverFileFor(
  span: Span,
  album: Album,
  accountId: string,
  permittedFolderIds: string[] | null,
): Promise<File | null> {
  if (!album.coverFileId) {
    return null;
  }
  const filter = folderFilterSql(permittedFolderIds);
  const params: any[] = [album.coverFileId, accountId];
  const filterParam = folderFilterParam(permittedFolderIds);
  if (filterParam !== null) {
    params.push(filterParam);
  }
  const rows = await SqlDbUtilsQuerySQL(
    span,
    "SELECT f.* FROM files f WHERE f.id = ? AND f.accountId = ? AND COALESCE(f.trashed, 0) = 0" +
      filter,
    params,
  );
  return rows.length > 0 ? FileDataFromRaw(rows[0]) : null;
}

function fromRaw(albumRaw: any): Album {
  const album = new Album(
    albumRaw.accountId,
    albumRaw.name,
    albumRaw.ownerUserId ?? null,
  );
  album.id = albumRaw.id;
  album.coverFileId = albumRaw.coverFileId ?? null;
  album.orderMode = albumRaw.orderMode === "manual" ? "manual" : "capture";
  album.dateCreated = new Date(albumRaw.dateCreated);
  album.dateUpdated = new Date(albumRaw.dateUpdated);
  album.info = JSON.parse(albumRaw.info || "{}");
  return album;
}
