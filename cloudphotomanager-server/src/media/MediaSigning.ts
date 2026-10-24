import { Span } from "@opentelemetry/sdk-trace-base";
import * as crypto from "crypto";
import { Config } from "../Config";
import { OTelTracer } from "../OTelContext";

// Signed, expiring media URLs replace the unauthenticated /static tree. The
// key is derived from the JWT key so it never leaves the server; URLs are
// bound to the account, file, asset and subject (user session or share).
const KEY_CONTEXT = "cpm-media-v1";
export const MEDIA_ASSETS = ["thumbnail.webp", "preview.webp", "preview.mp4"];
// Expiry is bucket-aligned so repeated listings inside the same bucket emit
// identical URLs and the browser/PWA cache keeps working.
const EXP_BUCKET_SECONDS = 300;

let mediaKey: Buffer;
let config: Config;

export interface MediaSignatureFields {
  kind: "user" | "share";
  accountId: string;
  fileId: string;
  asset: string;
  exp: number;
  subjectId: string;
  subjectVersion: number;
}

export function MediaSigningInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("MediaSigningInit", context);
  config = configIn;
  mediaKey = crypto
    .createHmac("sha256", configIn.JWT_KEY)
    .update(KEY_CONTEXT)
    .digest();
  span.end();
}

export function MediaAssetIsValid(asset: string): boolean {
  return MEDIA_ASSETS.includes(asset);
}

// Expiry aligned on a fixed bucket plus the configured TTL.
export function MediaSigningExp(
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  const bucketStart = Math.floor(nowSeconds / EXP_BUCKET_SECONDS) * EXP_BUCKET_SECONDS;
  return bucketStart + config.MEDIA_URL_TTL_SECONDS;
}

function canonical(fields: MediaSignatureFields): string {
  return [
    "v1",
    fields.kind,
    fields.accountId,
    fields.fileId,
    fields.asset,
    String(fields.exp),
    fields.subjectId,
    String(fields.subjectVersion),
  ].join("|");
}

export function MediaSigningSign(fields: MediaSignatureFields): string {
  return crypto
    .createHmac("sha256", mediaKey)
    .update(canonical(fields))
    .digest("base64url");
}

export function MediaSigningVerify(
  fields: MediaSignatureFields,
  signature: string,
): boolean {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  const expected = Buffer.from(MediaSigningSign(fields));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, provided);
}

export function MediaSigningUrl(fields: MediaSignatureFields): string {
  const signature = MediaSigningSign(fields);
  const base = `/api/media/${encodeURIComponent(fields.accountId)}/${encodeURIComponent(
    fields.fileId,
  )}/${fields.asset}?exp=${fields.exp}&sig=${signature}`;
  if (fields.kind === "share") {
    return `${base}&s=${encodeURIComponent(fields.subjectId)}`;
  }
  return base;
}
