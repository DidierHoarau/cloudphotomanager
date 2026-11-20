import { Span } from "@opentelemetry/sdk-trace";
import { SqlDbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { File } from "../model/File";
import {
  FILE_MEDIA_TYPE_EXTENSIONS,
  FileMediaType,
} from "../model/FileMediaType";
import { FileDataFromRaw } from "../files/FileData";
import { OTelTracer } from "../OTelContext";

export type MemoriesSectionKey = "onThisDay" | "pastWeek" | "monthHighlights";

export interface MemoriesSection {
  key: MemoriesSectionKey;
  files: File[];
}

// Bounds that keep the endpoint deterministic and cheap: a candidate window
// per section and a hard cap on returned files.
const MEMORIES_MAX_CANDIDATES = 500;
const MEMORIES_MAX_FILES = 30;
// Two files of the same folder taken within this window (inclusive) are the
// same burst and only its first (highest priority) representative is kept.
const MEMORIES_BURST_WINDOW_MS = 2000;

export interface MemoriesDate {
  year: number;
  month: number;
  day: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function mediaTypeCondition(): { sql: string; params: string[] } {
  const extensions = [
    ...FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.image],
    ...FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.imageRaw],
    ...FILE_MEDIA_TYPE_EXTENSIONS[FileMediaType.video],
  ];
  const conditions = extensions
    .map(() => "LOWER(filename) LIKE ?")
    .join(" OR ");
  return {
    sql: ` AND (${conditions}) `,
    params: extensions.map((extension) => `%.${extension}`),
  };
}

interface MemoriesSectionQuery {
  key: MemoriesSectionKey;
  conditionSql: string;
  conditionParams: string[];
  orderSql: string;
}

function sectionQueries(date: MemoriesDate): MemoriesSectionQuery[] {
  const monthDay = `${pad2(date.month)}-${pad2(date.day)}`;
  const month = pad2(date.month);
  const startOfYearIso = new Date(Date.UTC(date.year, 0, 1)).toISOString();
  const weekStartIso = new Date(
    Date.UTC(date.year, date.month - 1, date.day - 6),
  ).toISOString();
  const dayEndExclusiveIso = new Date(
    Date.UTC(date.year, date.month - 1, date.day + 1),
  ).toISOString();
  return [
    {
      key: "onThisDay",
      conditionSql: " AND dateMedia < ? AND substr(dateMedia, 6, 5) = ? ",
      conditionParams: [startOfYearIso, monthDay],
      orderSql: "dateMedia DESC, id DESC",
    },
    {
      key: "pastWeek",
      conditionSql: " AND dateMedia >= ? AND dateMedia < ? ",
      conditionParams: [weekStartIso, dayEndExclusiveIso],
      orderSql: "dateMedia DESC, id DESC",
    },
    {
      key: "monthHighlights",
      conditionSql: " AND dateMedia < ? AND substr(dateMedia, 6, 2) = ? ",
      conditionParams: [startOfYearIso, month],
      orderSql: "favorite DESC, dateMedia DESC, id DESC",
    },
  ];
}

// Deterministic "rediscover" feed: three sections computed from the library's
// existing date/favorite data. No new index and no background compute: each
// request runs at most three bounded, account- and permission-scoped queries.
export async function MemoriesDataList(
  context: Span,
  accountId: string,
  date: MemoriesDate,
  permittedFolderIds: string[] | null,
): Promise<MemoriesSection[]> {
  const span = OTelTracer().startSpan("MemoriesDataList", context);
  try {
    const media = mediaTypeCondition();
    const folderSql =
      permittedFolderIds === null
        ? ""
        : " AND folderId IN (SELECT value FROM json_each(?)) ";
    const baseWhereSql =
      " WHERE accountId = ? AND trashed = 0 AND COALESCE(syncGone, 0) = 0 " +
      " AND dateMedia IS NOT NULL AND filename NOT LIKE '%-outtake.%' " +
      folderSql +
      media.sql;
    const baseParams: any[] = [accountId];
    if (permittedFolderIds !== null) {
      baseParams.push(JSON.stringify(permittedFolderIds));
    }
    baseParams.push(...media.params);

    // Shared across sections: a file appears once, and a duplicate copy
    // (same non-empty hash) is represented only by its first occurrence.
    const usedFileIds = new Set<string>();
    const usedHashes = new Set<string>();
    const sections: MemoriesSection[] = [];

    for (const query of sectionQueries(date)) {
      const rawData = await SqlDbUtilsQuerySQL(
        span,
        "SELECT * FROM files" +
          baseWhereSql +
          query.conditionSql +
          " ORDER BY " +
          query.orderSql +
          " LIMIT ?",
        [
          ...baseParams,
          ...query.conditionParams,
          MEMORIES_MAX_CANDIDATES,
        ],
      );
      const files: File[] = [];
      // Burst grouping is per section: two shots of the same folder within
      // the window collapse into one memory picture.
      const lastKeptAtByFolder = new Map<string, number>();
      for (const fileRaw of rawData) {
        if (files.length >= MEMORIES_MAX_FILES) {
          break;
        }
        const file = FileDataFromRaw(fileRaw);
        if (!file.id || usedFileIds.has(file.id)) {
          continue;
        }
        if (!file.dateMedia || Number.isNaN(file.dateMedia.getTime())) {
          continue;
        }
        const hash = String(file.hash ?? "").trim();
        if (hash && usedHashes.has(hash)) {
          continue;
        }
        const capturedAt = file.dateMedia.getTime();
        const lastKeptAt = lastKeptAtByFolder.get(file.folderId);
        if (
          lastKeptAt !== undefined &&
          Math.abs(capturedAt - lastKeptAt) <= MEMORIES_BURST_WINDOW_MS
        ) {
          continue;
        }
        files.push(file);
        usedFileIds.add(file.id);
        if (hash) {
          usedHashes.add(hash);
        }
        lastKeptAtByFolder.set(file.folderId, capturedAt);
      }
      sections.push({ key: query.key, files });
    }
    return sections;
  } finally {
    span.end();
  }
}
