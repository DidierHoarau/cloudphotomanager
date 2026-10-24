import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";

// Shared state for the factory closures below: the daily-check loop reads the
// queue depth and the listing through them, and the spec mutates the state.
// Variables prefixed with "mock" are allowed inside jest.mock factories.
const mockBatchWaitState = {
  pollsUntilDrain: 0,
  listCalls: 0,
};

jest.mock("./SyncQueue", () => {
  const actual = jest.requireActual("./SyncQueue");
  return {
    ...actual,
    SyncQueueGetBatchWaitingCount: () => {
      if (mockBatchWaitState.pollsUntilDrain > 0) {
        mockBatchWaitState.pollsUntilDrain -= 1;
        return 20;
      }
      return 0;
    },
  };
});

jest.mock("../accounts/AccountFactory", () => ({
  AccountFactoryGetAccountImplementation: () => ({
    getAccountDefinition: () => ({ id: "acct-batchwait" }),
  }),
}));

jest.mock("../files/FileData", () => {
  const actual = jest.requireActual("../files/FileData");
  return {
    ...actual,
    FileDataListForAccountPaginated: () => {
      mockBatchWaitState.listCalls += 1;
      return Promise.resolve({ files: [], total: 0 });
    },
  };
});

import { SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews } from "./SyncFileCache";

const BATCH_MAX_WAIT_MS = 30 * 60_000;
const BATCH_WAIT_POLL_MS = 5_000;

describe("SyncFileCache daily-check batch wait", () => {
  let span: Span;

  beforeAll(() => {
    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    span = OTelTracer().startSpan("SyncFileCacheBatchWait.spec");
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockBatchWaitState.pollsUntilDrain = 0;
    mockBatchWaitState.listCalls = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits while the batch queue is saturated, then proceeds", async () => {
    mockBatchWaitState.pollsUntilDrain = 1;

    const run = SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
      span,
      "acct-batchwait",
    );
    // One poll interval later the queue has drained: the listing is reached.
    await jest.advanceTimersByTimeAsync(BATCH_WAIT_POLL_MS + 1_000);
    await run;

    expect(mockBatchWaitState.listCalls).toBe(1);
  });

  it("gives up after the max wait when the batch queue stays saturated", async () => {
    mockBatchWaitState.pollsUntilDrain = Number.MAX_SAFE_INTEGER;

    const run = SyncFileCacheCheckAndQueueMissingThumbnailsAndPreviews(
      span,
      "acct-batchwait",
    );
    // The loop must end by the cap: virtual time past BATCH_MAX_WAIT_MS is
    // enough for every BATCH_WAIT_POLL_MS tick to fire first.
    await jest.advanceTimersByTimeAsync(BATCH_MAX_WAIT_MS + BATCH_WAIT_POLL_MS);
    await run;

    // The give-up happens before any listing: nothing was queued.
    expect(mockBatchWaitState.listCalls).toBe(0);
  });
});
