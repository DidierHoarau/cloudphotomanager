import axios from "axios";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Config } from "../Config";

const WEBHOOK_TIMEOUT_MS = 10 * 1000;

const logger = OTelLogger().createModuleLogger("SyncNotifications");

let config: Config;

export function SyncNotificationsInit(context: Span, configIn: Config): void {
  const span = OTelTracer().startSpan("SyncNotificationsInit", context);
  config = configIn;
  span.end();
}

export interface SyncPersistentFailurePayload {
  accountId: string;
  accountName?: string;
  fileId: string;
  filename?: string;
  filePath?: string;
  operation: string;
  consecutiveFailures: number;
  errorMessage: string;
  likelyCause?: string;
  suggestedAction?: string;
}

// Fire-and-forget webhook fired once when a file hits the sync retry cap.
// Disabled while SYNC_FAILURE_WEBHOOK_URL is empty (default). Never throws
// into the sync queue: delivery problems are only logged.
export function SyncNotificationsNotifyPersistentFailure(
  payload: SyncPersistentFailurePayload,
): void {
  const url = config ? config.SYNC_FAILURE_WEBHOOK_URL : "";
  if (!url) {
    return;
  }
  axios
    .post(
      url,
      {
        event: "sync_persistent_failure",
        application: "cloudphotomanager",
        version: config.VERSION,
        date: new Date().toISOString(),
        ...payload,
      },
      { timeout: WEBHOOK_TIMEOUT_MS },
    )
    .catch((err) => {
      logger.warn(
        `Sync failure webhook delivery failed (${url}): ${err?.message || err}`,
      );
    });
}
