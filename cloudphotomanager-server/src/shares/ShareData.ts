import { Span } from "@opentelemetry/sdk-trace";
import * as crypto from "crypto";
import { Config } from "../Config";
import {
  ShareLink,
  ShareScope,
  ShareTokenMode,
} from "../model/ShareLink";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

// The token itself is the credential: it is only returned to an admin at
// creation/rotation and never stored — the database keeps its sha256 hash.
// Derived tokens are additionally re-derivable from the share id with the
// server key, which lets the overview re-copy a link without persisting it.
export interface ShareLinkCreated {
  share: ShareLink;
  token: string;
}

const TOKEN_CONTEXT = "cpm-share-v1";
const LAST_ACCESS_THROTTLE_MS = 60 * 1000;

let shareKey: Buffer = null;

export function ShareDataInit(context: Span, config: Config) {
  const span = OTelTracer().startSpan("ShareData_init", context);
  try {
    shareKey = crypto
      .createHmac("sha256", config.JWT_KEY)
      .update(TOKEN_CONTEXT)
      .digest();
  } finally {
    span.end();
  }
}

// Deterministic token for a derived share: same share id always yields the
// same token, so a re-copied link keeps working.
export function ShareDataTokenDerive(shareId: string): string | null {
  if (!shareKey || !shareId) {
    return null;
  }
  return crypto
    .createHmac("sha256", shareKey)
    .update(`${TOKEN_CONTEXT}|${shareId}`)
    .digest("base64url");
}

// The share URL path when the token can be re-derived (derived shares only);
// null for legacy random-token shares whose plaintext is gone.
export function ShareDataPathFor(share: ShareLink): string | null {
  if (!share || share.tokenMode !== "derived") {
    return null;
  }
  const token = ShareDataTokenDerive(share.id);
  if (!token) {
    return null;
  }
  return `/share?t=${encodeURIComponent(token)}`;
}

export interface ShareDataCreateScopeOptions {
  accountId: string;
  scope: ShareScope;
  scopeId: string;
  ownerUserId?: string;
  expiresInDays?: number;
  // Absolute expiry, used when rotating a share and keeping its deadline.
  expiresAt?: Date;
}

export async function ShareDataCreateForScope(
  context: Span,
  options: ShareDataCreateScopeOptions,
): Promise<ShareLinkCreated> {
  const span = OTelTracer().startSpan("ShareData_createForScope", context);
  try {
    const share = new ShareLink(
      options.accountId,
      options.scope === "folder" ? options.scopeId : "",
    );
    share.scope = options.scope;
    if (options.scope === "album") {
      share.albumId = options.scopeId;
    } else if (options.scope === "file") {
      share.fileId = options.scopeId;
    }
    share.ownerUserId = options.ownerUserId ?? null;
    if (options.expiresAt) {
      share.dateExpires = options.expiresAt;
    } else if (options.expiresInDays && options.expiresInDays > 0) {
      share.dateExpires = new Date(
        Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000,
      );
    }
    const derivedToken = ShareDataTokenDerive(share.id);
    const tokenMode: ShareTokenMode = derivedToken ? "derived" : "random";
    const token =
      derivedToken ?? crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await SqlDbUtilsExecSQL(
      span,
      "INSERT INTO shares (id, accountId, scope, folderId, albumId, fileId, tokenHash, tokenMode, ownerUserId, dateCreated, dateExpires, info) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        share.id,
        share.accountId,
        share.scope,
        share.folderId,
        share.albumId,
        share.fileId,
        tokenHash,
        tokenMode,
        share.ownerUserId,
        share.dateCreated.toISOString(),
        share.dateExpires ? share.dateExpires.toISOString() : null,
        JSON.stringify(share.info),
      ],
    );
    share.tokenMode = tokenMode;
    return { share, token };
  } finally {
    span.end();
  }
}

// Backwards-compatible folder share creation.
export async function ShareDataCreate(
  context: Span,
  accountId: string,
  folderId: string,
  expiresInDays?: number,
  ownerUserId?: string,
): Promise<ShareLinkCreated> {
  return ShareDataCreateForScope(context, {
    accountId,
    scope: "folder",
    scopeId: folderId,
    expiresInDays,
    ownerUserId,
  });
}

// Lists the active (non-expired) folder shares of a folder, oldest first.
// Tokens are never part of the result.
export async function ShareDataListForFolder(
  context: Span,
  accountId: string,
  folderId: string,
): Promise<ShareLink[]> {
  const span = OTelTracer().startSpan("ShareData_listForFolder", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE accountId = ? AND folderId = ? AND scope = 'folder' " +
        "AND (dateExpires IS NULL OR dateExpires > ?) ORDER BY dateCreated ASC",
      [accountId, folderId, new Date().toISOString()],
    );
    return rawData.map((row) => fromRaw(row));
  } finally {
    span.end();
  }
}

export interface ShareDataListActiveFilters {
  accountId?: string;
  scope?: ShareScope;
  scopeId?: string;
}

// Active (non-expired) shares across folders, albums and files, newest first.
// Optional filters narrow by account, scope and target id.
export async function ShareDataListActive(
  context: Span,
  filters: ShareDataListActiveFilters = {},
): Promise<ShareLink[]> {
  const span = OTelTracer().startSpan("ShareData_listActive", context);
  try {
    const conditions = ["(dateExpires IS NULL OR dateExpires > ?)"];
    const params: any[] = [new Date().toISOString()];
    if (filters.accountId) {
      conditions.push("accountId = ?");
      params.push(filters.accountId);
    }
    if (filters.scope) {
      conditions.push("scope = ?");
      params.push(filters.scope);
    }
    if (filters.scopeId) {
      conditions.push(
        "COALESCE(NULLIF(albumId, ''), NULLIF(fileId, ''), folderId) = ?",
      );
      params.push(filters.scopeId);
    }
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      `SELECT * FROM shares WHERE ${conditions.join(" AND ")} ORDER BY dateCreated DESC`,
      params,
    );
    return rawData.map((row) => fromRaw(row));
  } finally {
    span.end();
  }
}

// Resolves a share by token; returns null for unknown, expired or revoked
// tokens (indistinguishable on purpose: no existence oracle).
export async function ShareDataGetByToken(
  context: Span,
  token: string,
): Promise<ShareLink> {
  const span = OTelTracer().startSpan("ShareData_getByToken", context);
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE tokenHash = ? " +
        "AND (dateExpires IS NULL OR dateExpires > ?)",
      [tokenHash, new Date().toISOString()],
    );
    if (rawData.length === 0) {
      return null;
    }
    const share = fromRaw(rawData[0]);
    await ShareDataTouchLastAccess(span, share);
    return share;
  } finally {
    span.end();
  }
}

// Resolves an active share by its id. Revoked or expired shares return null,
// which is what makes previously issued media URLs stop working.
export async function ShareDataGet(
  context: Span,
  shareId: string,
): Promise<ShareLink> {
  const span = OTelTracer().startSpan("ShareData_get", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE id = ? " +
        "AND (dateExpires IS NULL OR dateExpires > ?)",
      [shareId, new Date().toISOString()],
    );
    if (rawData.length === 0) {
      return null;
    }
    const share = fromRaw(rawData[0]);
    await ShareDataTouchLastAccess(span, share);
    return share;
  } finally {
    span.end();
  }
}

// Resolves any share row by id, expired or not (management needs the row to
// revoke or rotate it). Returns null only when the row does not exist.
export async function ShareDataGetById(
  context: Span,
  shareId: string,
): Promise<ShareLink> {
  const span = OTelTracer().startSpan("ShareData_getById", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE id = ?",
      [shareId],
    );
    if (rawData.length === 0) {
      return null;
    }
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

// Resolves a share by id only when it belongs to the account/folder in the
// URL. Used by the folder-scoped admin revoke endpoint so a share of another
// account can never be deleted through a mismatched path.
export async function ShareDataGetForFolder(
  context: Span,
  accountId: string,
  folderId: string,
  shareId: string,
): Promise<ShareLink> {
  const span = OTelTracer().startSpan("ShareData_getForFolder", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE id = ? AND accountId = ? AND folderId = ?",
      [shareId, accountId, folderId],
    );
    if (rawData.length === 0) {
      return null;
    }
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function ShareDataDelete(
  context: Span,
  shareId: string,
): Promise<void> {
  const span = OTelTracer().startSpan("ShareData_delete", context);
  try {
    await SqlDbUtilsExecSQL(span, "DELETE FROM shares WHERE id = ?", [shareId]);
  } finally {
    span.end();
  }
}

// Account-scoped revoke for the overview endpoint.
export async function ShareDataDeleteForAccount(
  context: Span,
  accountId: string,
  shareId: string,
): Promise<number> {
  const span = OTelTracer().startSpan("ShareData_deleteForAccount", context);
  try {
    return await SqlDbUtilsExecSQL(
      span,
      "DELETE FROM shares WHERE id = ? AND accountId = ?",
      [shareId, accountId],
    );
  } finally {
    span.end();
  }
}

// Records a successful public access, at most once per minute per share so a
// browsing session does not write on every media request.
export async function ShareDataTouchLastAccess(
  context: Span,
  share: ShareLink,
): Promise<void> {
  if (!share?.id) {
    return;
  }
  const now = new Date();
  if (
    share.lastAccessDate &&
    now.getTime() - share.lastAccessDate.getTime() < LAST_ACCESS_THROTTLE_MS
  ) {
    return;
  }
  const span = OTelTracer().startSpan("ShareData_touchLastAccess", context);
  try {
    await SqlDbUtilsExecSQL(
      span,
      "UPDATE shares SET lastAccessDate = ? WHERE id = ? " +
        "AND (lastAccessDate IS NULL OR lastAccessDate < ?)",
      [
        now.toISOString(),
        share.id,
        new Date(now.getTime() - LAST_ACCESS_THROTTLE_MS).toISOString(),
      ],
    );
    share.lastAccessDate = now;
  } catch {
    // A missed last-access update must never fail the request it observes.
  } finally {
    span.end();
  }
}

// Private Function

function fromRaw(shareRaw: any): ShareLink {
  const scope: ShareScope = shareRaw.scope || "folder";
  const share = new ShareLink(
    shareRaw.accountId,
    shareRaw.folderId ?? (scope === "folder" ? "" : ""),
  );
  share.id = shareRaw.id;
  share.scope = scope;
  share.folderId = shareRaw.folderId ?? "";
  share.albumId = shareRaw.albumId ?? null;
  share.fileId = shareRaw.fileId ?? null;
  share.dateCreated = new Date(shareRaw.dateCreated);
  share.dateExpires = shareRaw.dateExpires
    ? new Date(shareRaw.dateExpires)
    : null;
  share.lastAccessDate = shareRaw.lastAccessDate
    ? new Date(shareRaw.lastAccessDate)
    : null;
  share.ownerUserId = shareRaw.ownerUserId ?? null;
  share.tokenMode = shareRaw.tokenMode || "random";
  share.info = JSON.parse(shareRaw.info);
  return share;
}
