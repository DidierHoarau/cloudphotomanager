import { createOTelContext } from "@devopsplaybook.io/common-utils";
import { Span } from "@opentelemetry/sdk-trace-base";

const ctx = createOTelContext();

export function OTelSetTracer(t: Parameters<typeof ctx.OTelSetTracer>[0]) {
  ctx.OTelSetTracer(t);
}

export function OTelSetMeter(m: Parameters<typeof ctx.OTelSetMeter>[0]) {
  ctx.OTelSetMeter(m);
}

export function OTelTracer() {
  return ctx.OTelTracer();
}

export function OTelMeter() {
  return ctx.OTelMeter();
}

export function OTelLogger() {
  return ctx.OTelLogger();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OTelRequestSpan(req: any): Span | undefined {
  return ctx.OTelRequestSpan(req);
}
