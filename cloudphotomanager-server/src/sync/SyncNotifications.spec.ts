import axios from "axios";
import { Config } from "../Config";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer } from "../OTelContext";
import {
  SyncNotificationsInit,
  SyncNotificationsNotifyPersistentFailure,
} from "./SyncNotifications";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

function buildConfig(webhookUrl: string): Config {
  return {
    SYNC_FAILURE_WEBHOOK_URL: webhookUrl,
    VERSION: "0.0.0",
  } as unknown as Config;
}

function payload(): Parameters<
  typeof SyncNotificationsNotifyPersistentFailure
>[0] {
  return {
    accountId: "account-1",
    accountName: "Homelab S3",
    fileId: "file-1",
    filename: "video.mov",
    filePath: "holidays/video.mov",
    operation: "syncVideoFromFull",
    consecutiveFailures: 5,
    errorMessage: "Error getting Video Width",
    likelyCause: "Video preview could not be generated",
    suggestedAction: "Rebuild its cache",
  };
}

describe("SyncNotificationsNotifyPersistentFailure", () => {
  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
  });

  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  it("posts the payload to the configured webhook URL", () => {
    SyncNotificationsInit(undefined as any, buildConfig("http://hooks.local/x"));
    mockedAxios.post.mockResolvedValue({ status: 200 });

    SyncNotificationsNotifyPersistentFailure(payload());

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockedAxios.post.mock.calls[0] as [string, any];
    expect(url).toBe("http://hooks.local/x");
    expect(body.event).toBe("sync_persistent_failure");
    expect(body.application).toBe("cloudphotomanager");
    expect(body.version).toBe("0.0.0");
    expect(body.fileId).toBe("file-1");
    expect(body.consecutiveFailures).toBe(5);
    expect(body.likelyCause).toContain("Video preview");
    expect(body.suggestedAction).toContain("Rebuild");
    expect(typeof body.date).toBe("string");
  });

  it("does not perform any HTTP call when the webhook URL is empty", () => {
    SyncNotificationsInit(undefined as any, buildConfig(""));

    SyncNotificationsNotifyPersistentFailure(payload());

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("swallows webhook delivery errors without throwing", () => {
    SyncNotificationsInit(undefined as any, buildConfig("http://hooks.local/x"));
    mockedAxios.post.mockRejectedValue(new Error("connection refused"));

    expect(() =>
      SyncNotificationsNotifyPersistentFailure(payload()),
    ).not.toThrow();
    // The rejection must be handled: flush microtasks to make sure no
    // unhandled promise rejection escapes the fire-and-forget call.
    return new Promise((resolve) => setTimeout(resolve, 0));
  });
});
