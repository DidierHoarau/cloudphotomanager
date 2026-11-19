import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer } from "../OTelContext";
import type { Config } from "../Config";
import {
  ENRICHMENT_CIRCUIT_BASE_MS,
  ENRICHMENT_CIRCUIT_MAX_MS,
  EnrichmentRuntimeCanAttempt,
  EnrichmentRuntimeGetState,
  EnrichmentRuntimeInit,
  EnrichmentRuntimeRecordModelFailure,
  EnrichmentRuntimeRecordSuccess,
  EnrichmentRuntimeResetForTests,
} from "./EnrichmentRuntime";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATA_DIR: "/data",
    IMAGE_CLASSIFICATION_ENABLED: true,
    IMAGE_CLASSIFICATION_MODEL: "Xenova/mobilenet_v2_1.0_224",
    IMAGE_CLASSIFICATION_MODEL_PATH: "",
    IMAGE_CLASSIFICATION_HF_ENDPOINT: "",
    IMAGE_CLASSIFICATION_CACHE_DIR: "",
    ...overrides,
  } as unknown as Config;
}

describe("EnrichmentRuntime circuit breaker", () => {
  let now = 1_700_000_000_000;

  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
  });

  beforeEach(() => {
    EnrichmentRuntimeResetForTests();
    now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    EnrichmentRuntimeResetForTests();
  });

  it("is disabled by configuration and never attempts a model load", () => {
    EnrichmentRuntimeInit(
      testConfig({ IMAGE_CLASSIFICATION_ENABLED: false }),
    );
    expect(EnrichmentRuntimeCanAttempt()).toBe(false);
    const state = EnrichmentRuntimeGetState();
    expect(state.enabled).toBe(false);
  });

  it("reports the configured model source and a local directory warning", () => {
    EnrichmentRuntimeInit(
      testConfig({ IMAGE_CLASSIFICATION_MODEL_PATH: "/models/does-not-exist" }),
    );
    const state = EnrichmentRuntimeGetState();
    expect(state.modelSource).toBe("local:/models/does-not-exist");
    expect(state.startupWarning).toContain("does not exist");
  });

  it("opens the circuit with bounded exponential backoff", () => {
    EnrichmentRuntimeInit(testConfig());

    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    expect(EnrichmentRuntimeCanAttempt()).toBe(false);
    expect(EnrichmentRuntimeGetState().retryAfterSeconds).toBe(
      ENRICHMENT_CIRCUIT_BASE_MS / 1000,
    );

    // After the backoff elapses an attempt is allowed again.
    now += ENRICHMENT_CIRCUIT_BASE_MS;
    expect(EnrichmentRuntimeCanAttempt()).toBe(true);

    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    expect(EnrichmentRuntimeGetState().retryAfterSeconds).toBe(
      (ENRICHMENT_CIRCUIT_BASE_MS * 2) / 1000,
    );

    // Backoff keeps doubling up to the cap.
    now += ENRICHMENT_CIRCUIT_BASE_MS * 2;
    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    now += ENRICHMENT_CIRCUIT_BASE_MS * 4;
    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    now += ENRICHMENT_CIRCUIT_BASE_MS * 8;
    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    now += ENRICHMENT_CIRCUIT_BASE_MS * 16;
    EnrichmentRuntimeRecordModelFailure(new Error("401 Unauthorized"));
    const state = EnrichmentRuntimeGetState();
    expect(state.consecutiveModelFailures).toBe(6);
    expect(state.retryAfterSeconds).toBe(ENRICHMENT_CIRCUIT_MAX_MS / 1000);
    expect(state.lastModelError).toContain("401 Unauthorized");
  });

  it("a successful inference closes the circuit and clears the error", () => {
    EnrichmentRuntimeInit(testConfig());
    EnrichmentRuntimeRecordModelFailure(new Error("boom"));
    EnrichmentRuntimeRecordSuccess();
    expect(EnrichmentRuntimeCanAttempt()).toBe(true);
    const state = EnrichmentRuntimeGetState();
    expect(state.circuitOpen).toBe(false);
    expect(state.consecutiveModelFailures).toBe(0);
    expect(state.lastModelError).toBeNull();
  });
});
