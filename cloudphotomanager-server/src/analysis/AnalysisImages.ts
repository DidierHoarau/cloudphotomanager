import { pipeline } from "@huggingface/transformers";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "../OTelContext";
import { TimeoutWait } from "../utils-std-ts/Timeout";
import { Config } from "../Config";

let config: Config;

export async function AnalysisImagesInit(
  context: Span,
  inConfig: Config
): Promise<void> {
  const span = OTelTracer().startSpan("AnalysisImagesInit", context);
  config = inConfig;
  releasePipeline();
  span.end();
}

export async function AnalysisImagesGetLabels(
  context: Span,
  imagePath: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const span = OTelTracer().startSpan("AnalysisImagesGetLabels", context);
  dateLastUsed = new Date();
  while (pipeInitializing) {
    await TimeoutWait(1000);
  }
  if (!pipe) {
    pipeInitializing = true;
    // pipe = await pipeline("image-classification", null, {
    //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //   dtype: config.IMAGE_CLASSIFICATION_PROCESS_DTYPE as any,
    //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //   device: config.IMAGE_CLASSIFICATION_PROCESS_DEVICE as any,
    // });
    pipe = await pipeline("image-classification");
    pipeInitializing = false;
  }
  const results = await pipe(imagePath);
  span.end();
  return results;
}

// Private Function

let dateLastUsed;
let pipe;
let pipeInitializing = false;

function releasePipeline() {
  if (
    dateLastUsed ||
    dateLastUsed < new Date(new Date().getTime() - 60 * 60 * 1000)
  ) {
    pipe = null;
  }
  setTimeout(() => {
    releasePipeline();
  }, 3600 * 1000);
}
