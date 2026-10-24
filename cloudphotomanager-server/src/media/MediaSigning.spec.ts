import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import {
  MEDIA_ASSETS,
  MediaAssetIsValid,
  MediaSignatureFields,
  MediaSigningExp,
  MediaSigningInit,
  MediaSigningSign,
  MediaSigningUrl,
  MediaSigningVerify,
} from "./MediaSigning";

describe("MediaSigning", () => {
  let span: Span;
  const config = {
    JWT_KEY: "test-media-signing-key",
    MEDIA_URL_TTL_SECONDS: 3600,
    MEDIA_CACHE_SECONDS: 300,
  } as unknown as Config;

  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
    span = OTelTracer().startSpan("MediaSigning.spec");
    MediaSigningInit(span, config);
  });

  const fields = (
    overrides: Partial<MediaSignatureFields> = {},
  ): MediaSignatureFields => ({
    kind: "user",
    accountId: "acc-1",
    fileId: "file-1",
    asset: "thumbnail.webp",
    exp: 2_000_000_000,
    subjectId: "user-1",
    subjectVersion: 0,
    ...overrides,
  });

  it("only accepts the three cached media assets", () => {
    expect(MEDIA_ASSETS).toEqual([
      "thumbnail.webp",
      "preview.webp",
      "preview.mp4",
    ]);
    for (const asset of MEDIA_ASSETS) {
      expect(MediaAssetIsValid(asset)).toBe(true);
    }
    for (const asset of [
      "original.jpg",
      "../thumbnail.webp",
      "thumbnail.webp/../x",
      "",
    ]) {
      expect(MediaAssetIsValid(asset)).toBe(false);
    }
  });

  it("verifies a signature it produced and rejects any field tampering", () => {
    const signature = MediaSigningSign(fields());
    expect(MediaSigningVerify(fields(), signature)).toBe(true);

    const tampered = [
      { accountId: "acc-2" },
      { fileId: "file-2" },
      { asset: "preview.webp" },
      { exp: 2_000_000_001 },
      { subjectId: "user-2" },
      { subjectVersion: 1 },
      { kind: "share" as const },
    ];
    for (const change of tampered) {
      expect(MediaSigningVerify(fields(change), signature)).toBe(false);
    }
    expect(MediaSigningVerify(fields(), "")).toBe(false);
    expect(MediaSigningVerify(fields(), "not-the-signature")).toBe(false);
  });

  it("builds URLs carrying the expiry and signature, plus the share id for shares", () => {
    const userUrl = MediaSigningUrl(fields());
    expect(userUrl).toContain("/api/media/acc-1/file-1/thumbnail.webp?exp=");
    expect(userUrl).toContain("sig=");
    expect(userUrl).not.toContain("&s=");

    const shareUrl = MediaSigningUrl(
      fields({ kind: "share", subjectId: "share-1" }),
    );
    expect(shareUrl).toContain("&s=share-1");
  });

  it("bucket-aligns the expiry so repeated listings reuse the same URLs", () => {
    // Same 300s bucket -> identical exp; the next bucket moves it forward.
    expect(MediaSigningExp(1_000_000_001)).toBe(
      MediaSigningExp(1_000_000_100),
    );
    expect(MediaSigningExp(1_000_000_400)).toBe(
      MediaSigningExp(1_000_000_100) + 300,
    );
    const now = Math.floor(Date.now() / 1000);
    expect(MediaSigningExp()).toBeGreaterThan(now);
    expect(MediaSigningExp()).toBeLessThanOrEqual(
      now + config.MEDIA_URL_TTL_SECONDS + 300,
    );
  });
});
