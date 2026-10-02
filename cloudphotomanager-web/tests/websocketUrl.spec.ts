import { describe, expect, it, vi } from "vitest";
import { buildSyncWebSocketUrl } from "../services/WebSocketUrl";

describe("buildSyncWebSocketUrl", () => {
  it("converts an https API base to wss and carries no token", () => {
    const url = buildSyncWebSocketUrl("https://photos.example.com/api");
    expect(url).toBe("wss://photos.example.com/api/sync/ws");
    expect(url).not.toContain("token");
  });

  it("converts an http API base to ws", () => {
    expect(buildSyncWebSocketUrl("http://localhost:8080/api")).toBe(
      "ws://localhost:8080/api/sync/ws",
    );
  });

  it("derives the origin for a relative API base (same-origin app)", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "photos.example.com" },
    });
    try {
      expect(buildSyncWebSocketUrl("/api")).toBe(
        "wss://photos.example.com/api/sync/ws",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
