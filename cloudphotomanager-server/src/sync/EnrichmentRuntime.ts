import * as fs from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("EnrichmentRuntime");

// Model acquisition failures (HuggingFace download, mirror endpoint, broken
// local model directory) open a circuit instead of attempting a download for
// every queued file. Backoff is bounded: 60s, 2x per consecutive failure,
// capped at 30min. Per-image inference errors never open the circuit.
export const ENRICHMENT_CIRCUIT_BASE_MS = 60 * 1000;
export const ENRICHMENT_CIRCUIT_MAX_MS = 30 * 60 * 1000;

export interface EnrichmentRuntimeState {
  enabled: boolean;
  modelSource: string;
  cacheDir: string;
  circuitOpen: boolean;
  retryAfterSeconds: number;
  consecutiveModelFailures: number;
  lastModelError: string | null;
  lastModelErrorAt: string | null;
  startupWarning: string | null;
}

let enabled = true;
let modelSource = "";
let cacheDir = "";
let circuitOpenUntilMs = 0;
let consecutiveModelFailures = 0;
let lastModelError: string | null = null;
let lastModelErrorAt: string | null = null;
let startupWarning: string | null = null;

export function EnrichmentRuntimeInit(config: Config): void {
  enabled = config?.IMAGE_CLASSIFICATION_ENABLED !== false;
  modelSource = describeModelSource(config);
  cacheDir =
    config?.IMAGE_CLASSIFICATION_CACHE_DIR ||
    (config?.DATA_DIR ? path.join(config.DATA_DIR, "models") : "");
  circuitOpenUntilMs = 0;
  consecutiveModelFailures = 0;
  lastModelError = null;
  lastModelErrorAt = null;
  startupWarning = null;

  if (!enabled) {
    logger.info(
      "Image classification is disabled (IMAGE_CLASSIFICATION_ENABLED=N): keyword enrichment is skipped, filename keywords are kept",
    );
    return;
  }

  const warning = validateModelSource(config);
  if (warning) {
    startupWarning = warning;
    lastModelError = warning;
    lastModelErrorAt = new Date().toISOString();
    logger.warn(`Image classification configuration: ${warning}`);
    return;
  }
  logger.info(`Image classification model source: ${modelSource}`);
}

export function EnrichmentRuntimeIsEnabled(): boolean {
  return enabled;
}

export function EnrichmentRuntimeCanAttempt(): boolean {
  return enabled && Date.now() >= circuitOpenUntilMs;
}

export function EnrichmentRuntimeGetModelSource(): string {
  return modelSource;
}

export function EnrichmentRuntimeRecordModelFailure(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  consecutiveModelFailures++;
  const delay = Math.min(
    ENRICHMENT_CIRCUIT_MAX_MS,
    ENRICHMENT_CIRCUIT_BASE_MS * Math.pow(2, consecutiveModelFailures - 1),
  );
  circuitOpenUntilMs = Date.now() + delay;
  lastModelError = message;
  lastModelErrorAt = new Date().toISOString();
  logger.warn(
    `Image classification model unavailable (${message}); pausing enrichment for ${Math.round(delay / 1000)}s`,
  );
  return delay;
}

export function EnrichmentRuntimeRecordSuccess(): void {
  consecutiveModelFailures = 0;
  circuitOpenUntilMs = 0;
  lastModelError = null;
  lastModelErrorAt = null;
}

// A manual repair is an explicit operator action: clear the circuit so the
// retry runs immediately after model access has been restored.
export function EnrichmentRuntimeReset(): void {
  consecutiveModelFailures = 0;
  circuitOpenUntilMs = 0;
  lastModelError = null;
  lastModelErrorAt = null;
}

export function EnrichmentRuntimeGetState(): EnrichmentRuntimeState {
  const remainingMs = Math.max(0, circuitOpenUntilMs - Date.now());
  return {
    enabled,
    modelSource,
    cacheDir,
    circuitOpen: remainingMs > 0,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    consecutiveModelFailures,
    lastModelError,
    lastModelErrorAt,
    startupWarning,
  };
}

// Test-only helper to keep specs independent from the singleton state.
export function EnrichmentRuntimeResetForTests(): void {
  enabled = true;
  modelSource = "";
  cacheDir = "";
  circuitOpenUntilMs = 0;
  consecutiveModelFailures = 0;
  lastModelError = null;
  lastModelErrorAt = null;
  startupWarning = null;
}

function describeModelSource(config: Config): string {
  if (!config) {
    return "";
  }
  if (config.IMAGE_CLASSIFICATION_MODEL_PATH) {
    return `local:${config.IMAGE_CLASSIFICATION_MODEL_PATH}`;
  }
  const endpoint = config.IMAGE_CLASSIFICATION_HF_ENDPOINT;
  return endpoint
    ? `remote:${endpoint}/${config.IMAGE_CLASSIFICATION_MODEL}`
    : `remote:huggingface/${config.IMAGE_CLASSIFICATION_MODEL}`;
}

// Startup validation only warns: the application must boot without model
// access. An unavailable model is reported through the health panel.
function validateModelSource(config: Config): string | null {
  const modelPath = config?.IMAGE_CLASSIFICATION_MODEL_PATH;
  if (modelPath) {
    if (!path.isAbsolute(modelPath)) {
      return `IMAGE_CLASSIFICATION_MODEL_PATH "${modelPath}" is not an absolute path`;
    }
    if (!fs.existsSync(modelPath)) {
      return `local model directory "${modelPath}" does not exist`;
    }
    return null;
  }
  const endpoint = config?.IMAGE_CLASSIFICATION_HF_ENDPOINT;
  if (endpoint) {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `IMAGE_CLASSIFICATION_HF_ENDPOINT "${endpoint}" must be an http(s) URL`;
      }
    } catch {
      return `IMAGE_CLASSIFICATION_HF_ENDPOINT "${endpoint}" is not a valid URL`;
    }
  }
  return null;
}
