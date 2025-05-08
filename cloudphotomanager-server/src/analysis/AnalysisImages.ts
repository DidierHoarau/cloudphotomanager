import { pipeline } from "@huggingface/transformers";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { Timeout } from "../utils-std-ts/Timeout";

export async function AnalysisImagesInit(context: Span): Promise<void> {
  const span = StandardTracerStartSpan("AnalysisImagesInit", context);
  releasePipeline();
  span.end();
}

export async function AnalysisImagesGetLabels(context: Span, imagePath: string): Promise<any[]> {
  const span = StandardTracerStartSpan("AnalysisImagesGetLabels", context);
  dateLastUsed = new Date();
  while (pipeInitializing) {
    await Timeout.wait(1000);
  }
  if (!pipe) {
    pipeInitializing = true;
    pipe = await pipeline("image-classification", null, { dtype: "auto" });
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
  if (dateLastUsed || dateLastUsed < new Date(new Date().getTime() - 60 * 60 * 1000)) {
    pipe = null;
  }
  setTimeout(() => {
    releasePipeline();
  }, 3600 * 1000);
}
