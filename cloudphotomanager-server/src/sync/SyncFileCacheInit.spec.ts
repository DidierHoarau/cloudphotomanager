import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import {
  SyncFileCacheInit,
  SyncFileCacheResolveTempCacheDir,
} from "./SyncFileCache";

// The heavy inference stack is irrelevant here and must not be loaded.
jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("SyncFileCache temp directory handling", () => {
  let span: Span;
  let baseDir: string;

  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
    span = OTelTracer().startSpan("SyncFileCacheInit.spec");
  });

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-filecache-init-"));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  afterAll(() => {
    span.end();
  });

  it("resolves the app-owned cache directory under an absolute TMP_DIR", () => {
    expect(SyncFileCacheResolveTempCacheDir("/tmp")).toBe("/tmp/cache");
    expect(SyncFileCacheResolveTempCacheDir(baseDir)).toBe(
      path.join(baseDir, "cache"),
    );
  });

  it("refuses empty, relative and root TMP_DIR values", () => {
    expect(SyncFileCacheResolveTempCacheDir("")).toBeNull();
    expect(SyncFileCacheResolveTempCacheDir("   ")).toBeNull();
    expect(SyncFileCacheResolveTempCacheDir("relative/tmp")).toBeNull();
    expect(SyncFileCacheResolveTempCacheDir("/")).toBeNull();
    expect(SyncFileCacheResolveTempCacheDir("//")).toBeNull();
  });

  it("removes only the cache subtree on startup, preserving unrelated files", async () => {
    const cacheFile = path.join(baseDir, "cache", "account", "a", "file");
    const unrelatedFile = path.join(baseDir, "keep.txt");
    await fs.ensureDir(path.dirname(cacheFile));
    await fs.writeFile(cacheFile, "cached");
    await fs.writeFile(unrelatedFile, "keep");

    await SyncFileCacheInit(span, { TMP_DIR: baseDir } as unknown as Config);

    expect(fs.existsSync(path.join(baseDir, "cache"))).toBe(false);
    expect(fs.existsSync(unrelatedFile)).toBe(true);
  });

  it("does nothing when TMP_DIR is a dangerous path", async () => {
    // A relative TMP_DIR must not be resolved against the process cwd and
    // wiped; the file in the working directory stays untouched.
    const probe = path.join(baseDir, "cache-probe");
    await fs.writeFile(probe, "keep");

    await SyncFileCacheInit(span, {
      TMP_DIR: path.relative(process.cwd(), baseDir),
    } as unknown as Config);

    expect(fs.existsSync(probe)).toBe(true);
  });
});
