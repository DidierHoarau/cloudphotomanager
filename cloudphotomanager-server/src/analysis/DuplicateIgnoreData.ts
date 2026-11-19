import { Span } from "@opentelemetry/sdk-trace";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { DuplicateIgnore, DuplicateIgnoreInfo } from "../model/DuplicateIgnore";

export interface DuplicateIgnoreEntry {
  hash: string;
  filename?: string;
  folderId?: string;
  fileCount?: number;
}

// Ignores are account-level and keyed by the exact content hash: duplicate
// detection stays exact-hash only and an ignore survives a reboot.
export async function DuplicateIgnoreDataAddMany(
  context: Span,
  accountId: string,
  entries: DuplicateIgnoreEntry[],
  userId: string | null = null,
): Promise<number> {
  const span = OTelTracer().startSpan("DuplicateIgnoreData_addMany", context);
  let inserted = 0;
  const now = new Date().toISOString();
  for (const entry of entries) {
    const info: DuplicateIgnoreInfo = {};
    if (entry.fileCount !== undefined) info.fileCount = entry.fileCount;
    if (entry.filename !== undefined) info.filename = entry.filename;
    if (entry.folderId !== undefined) info.folderId = entry.folderId;
    // Repeated ignores are a no-op so the operation is idempotent.
    inserted += SqlDbUtilsExecSQL(
      span,
      "INSERT INTO duplicate_ignores (accountId, hash, dateIgnored, userId, info) " +
        " VALUES (?, ?, ?, ?, ?) " +
        " ON CONFLICT (accountId, hash) DO NOTHING ",
      [accountId, entry.hash, now, userId, JSON.stringify(info)],
    );
  }
  span.end();
  return inserted;
}

export async function DuplicateIgnoreDataRemove(
  context: Span,
  accountId: string,
  hashes: string[],
): Promise<number> {
  const span = OTelTracer().startSpan("DuplicateIgnoreData_remove", context);
  if (!hashes || hashes.length === 0) {
    span.end();
    return 0;
  }
  const placeholders = hashes.map(() => "?").join(", ");
  const removed = SqlDbUtilsExecSQL(
    span,
    `DELETE FROM duplicate_ignores WHERE accountId = ? AND hash IN (${placeholders})`,
    [accountId, ...hashes],
  );
  span.end();
  return removed;
}

export async function DuplicateIgnoreDataList(
  context: Span,
  accountId: string,
): Promise<DuplicateIgnore[]> {
  const span = OTelTracer().startSpan("DuplicateIgnoreData_list", context);
  const rows = await SqlDbUtilsQuerySQL(
    span,
    "SELECT accountId, hash, dateIgnored, userId, info FROM duplicate_ignores " +
      " WHERE accountId = ? ORDER BY dateIgnored DESC, hash ",
    [accountId],
  );
  const ignores: DuplicateIgnore[] = rows.map((row) => ({
    accountId: row.accountId,
    hash: row.hash,
    dateIgnored: row.dateIgnored,
    userId: row.userId ?? undefined,
    info: parseInfo(row.info),
  }));
  span.end();
  return ignores;
}

// Deletes ignores whose hash no longer forms a group (fewer than two live,
// non-trashed copies): the group was resolved, so there is nothing left to
// dismiss. Lazy cleanup keeps the table bounded without a TTL job.
export async function DuplicateIgnoreDataPruneStale(
  context: Span,
  accountId: string,
): Promise<number> {
  const span = OTelTracer().startSpan(
    "DuplicateIgnoreData_pruneStale",
    context,
  );
  const removed = SqlDbUtilsExecSQL(
    span,
    "DELETE FROM duplicate_ignores " +
      " WHERE accountId = ? AND hash NOT IN ( " +
      "   SELECT hash FROM files " +
      "    WHERE accountId = ? AND hash IS NOT NULL AND hash != '' " +
      "      AND COALESCE(trashed, 0) = 0 " +
      "    GROUP BY hash HAVING COUNT(*) >= 2 ) ",
    [accountId, accountId],
  );
  span.end();
  return removed;
}

function parseInfo(raw: unknown): DuplicateIgnoreInfo {
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const info: DuplicateIgnoreInfo = {};
    if (typeof parsed.fileCount === "number") {
      info.fileCount = parsed.fileCount;
    }
    if (typeof parsed.filename === "string") {
      info.filename = parsed.filename;
    }
    if (typeof parsed.folderId === "string") {
      info.folderId = parsed.folderId;
    }
    return info;
  } catch {
    return {};
  }
}
