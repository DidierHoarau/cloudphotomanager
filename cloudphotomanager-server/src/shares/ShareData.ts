import { Span } from "@opentelemetry/sdk-trace-base";
import * as crypto from "crypto";
import { ShareLink } from "../model/ShareLink";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

// The token itself is the credential: it is only returned once at creation
// and never stored — the database keeps its sha256 hash.
export interface ShareLinkCreated {
  share: ShareLink;
  token: string;
}

export async function ShareDataCreate(
  context: Span,
  accountId: string,
  folderId: string,
  expiresInDays?: number,
): Promise<ShareLinkCreated> {
  const span = OTelTracer().startSpan("ShareData_create", context);
  try {
    const share = new ShareLink(accountId, folderId);
    if (expiresInDays && expiresInDays > 0) {
      share.dateExpires = new Date(
        Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
      );
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await SqlDbUtilsExecSQL(
      span,
      "INSERT INTO shares (id, accountId, folderId, tokenHash, dateCreated, dateExpires, info) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ",
      [
        share.id,
        share.accountId,
        share.folderId,
        tokenHash,
        share.dateCreated.toISOString(),
        share.dateExpires ? share.dateExpires.toISOString() : null,
        JSON.stringify(share.info),
      ],
    );
    return { share, token };
  } finally {
    span.end();
  }
}

// Lists the active (non-expired) shares of a folder, oldest first. Tokens are
// never part of the result.
export async function ShareDataListForFolder(
  context: Span,
  accountId: string,
  folderId: string,
): Promise<ShareLink[]> {
  const span = OTelTracer().startSpan("ShareData_listForFolder", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM shares WHERE accountId = ? AND folderId = ? " +
        "AND (dateExpires IS NULL OR dateExpires > ?) ORDER BY dateCreated ASC",
      [accountId, folderId, new Date().toISOString()],
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
    return fromRaw(rawData[0]);
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
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

// Resolves a share by id only when it belongs to the account/folder in the
// URL. Used by the admin revoke endpoint so a share of another account can
// never be deleted through a mismatched path.
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

// Private Function

function fromRaw(shareRaw: any): ShareLink {
  const share = new ShareLink(shareRaw.accountId, shareRaw.folderId);
  share.id = shareRaw.id;
  share.dateCreated = new Date(shareRaw.dateCreated);
  share.dateExpires = shareRaw.dateExpires
    ? new Date(shareRaw.dateExpires)
    : null;
  share.info = JSON.parse(shareRaw.info);
  return share;
}
