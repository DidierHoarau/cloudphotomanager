import { pipeline } from "@huggingface/transformers";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Config } from "../Config";

const logger = OTelLogger().createModuleLogger("AnalysisImages");

// Memory tunables:
// - Release the ~hundreds-of-MB model after a short idle window and check
//   frequently so memory is actually returned between bursts of activity.
// - Cap the label list we keep from each inference (caller only uses
//   results with score > 0.5, so a small top_k is plenty).
const IDLE_RELEASE_MS = 10 * 60 * 1000; // 10 minutes
const RELEASE_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const TOP_K_LABELS = 5;

export async function AnalysisImagesInit(
  context: Span,
  inConfig: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalysisImagesInit", context);
  config = inConfig;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  scheduleReleaseCheck();
  span.end();
}

export async function AnalysisImagesGetLabels(
  context: Span,
  imagePath: string,
): Promise<{ label: string; score: number }[]> {
  const span = OTelTracer().startSpan("AnalysisImagesGetLabels", context);
  if (config && !config.IMAGE_CLASSIFICATION_ENABLED) {
    span.end();
    return [];
  }

  // Serialize inference calls so at most one image's decoded pixels and
  // activation tensors live in memory at a time. Without this, N parallel
  // queue workers would each hold their own tensor buffers (easily hundreds
  // of MB total).
  const prev = inferenceTail;
  let release!: () => void;
  inferenceTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prev;
    dateLastUsed = new Date();
    await ensurePipeline();

    // Ask the pipeline for only the top-K labels to avoid retaining a long
    // result array (some models default to the full label space).
    const raw = (await pipe(imagePath, { top_k: TOP_K_LABELS })) as Array<{
      label: string;
      score: number;
    }>;

    // Copy out only the fields the caller uses so nothing in the returned
    // array keeps a reference to the pipeline's internal objects.
    const results: { label: string; score: number }[] = [];
    if (Array.isArray(raw)) {
      const max = Math.min(raw.length, TOP_K_LABELS);
      for (let i = 0; i < max; i++) {
        results.push({ label: raw[i].label, score: raw[i].score });
      }
    }

    dateLastUsed = new Date();
    return results;
  } catch (err) {
    if (err instanceof Error) {
      span.recordException(err);
    }
    throw err;
  } finally {
    release();
    span.end();
  }
}

// Private State

let config: Config | null = null;
let dateLastUsed: Date | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;
let inferenceTail: Promise<void> = Promise.resolve();
let releaseTimer: NodeJS.Timeout | null = null;

// Single-flight pipeline initialization: concurrent callers share one
// Promise instead of each racing to load the model (which previously could
// double-load on the first burst of parallel requests).
async function ensurePipeline(): Promise<void> {
  if (pipe) return;
  if (!pipePromise) {
    pipePromise = pipeline("image-classification")
      .then((p) => {
        pipe = p;
        return p;
      })
      .catch((err) => {
        pipePromise = null;
        throw err;
      });
  }
  await pipePromise;
}

function scheduleReleaseCheck(): void {
  if (releaseTimer) return;
  releaseTimer = setTimeout(async () => {
    releaseTimer = null;
    try {
      await maybeReleasePipeline();
    } catch (err) {
      logger.error(`Error releasing image-classification pipeline: ${err}`);
    }
    scheduleReleaseCheck();
  }, RELEASE_CHECK_INTERVAL_MS);
  // Do not keep the event loop alive for this housekeeping timer.
  if (typeof releaseTimer.unref === "function") {
    releaseTimer.unref();
  }
}

async function maybeReleasePipeline(): Promise<void> {
  if (!pipe) return;
  if (
    dateLastUsed === null ||
    dateLastUsed.getTime() >= Date.now() - IDLE_RELEASE_MS
  ) {
    return;
  }
  // Wait for any in-flight inference to complete before disposing so we
  // don't pull the model out from under an active call.
  await inferenceTail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = pipe;
  pipe = null;
  pipePromise = null;
  dateLastUsed = null;
  if (p && typeof p.dispose === "function") {
    try {
      await p.dispose();
    } catch (err) {
      logger.error(`Pipeline dispose error: ${err}`);
    }
  }
  // Nudge the GC when the host exposes it (node --expose-gc). Harmless
  // no-op otherwise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (global as any).gc;
  if (typeof g === "function") {
    try {
      g();
    } catch {
      // ignore
    }
  }
}
