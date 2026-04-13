import { pipeline } from "@huggingface/transformers";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "../OTelContext";
import { TimeoutWait } from "../utils-std-ts/Timeout";
import { Config } from "../Config";

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
  releasePipeline();
  span.end();
}

export async function AnalysisImagesGetLabels(
  context: Span,
  imagePath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const span = OTelTracer().startSpan("AnalysisImagesGetLabels", context);
  if (config && !config.IMAGE_CLASSIFICATION_ENABLED) {
    span.end();
    return [];
  }
  dateLastUsed = new Date();
  while (pipeInitializing) {
    await TimeoutWait(1000);
  }
  if (!pipe) {
    pipeInitializing = true;
    pipe = await pipeline("image-classification");
    pipeInitializing = false;
  }
  const results = await pipe(imagePath);
  span.end();
  return results;
}

// Private Function

let config: Config | null = null;
let dateLastUsed: Date | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any;
let pipeInitializing = false;
let releaseTimer: NodeJS.Timeout | null = null;

async function releasePipeline() {
  if (
    dateLastUsed !== null &&
    dateLastUsed < new Date(Date.now() - 60 * 60 * 1000)
  ) {
    if (pipe && typeof pipe.dispose === "function") {
      await pipe.dispose();
    }
    pipe = null;
    dateLastUsed = null;
  }
  releaseTimer = setTimeout(() => {
    releasePipeline();
  }, 3600 * 1000);
}
