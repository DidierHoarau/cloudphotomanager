import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOGIN_CODES_BASE_URL,
  loginCodesIsAvailable,
  loginCodesServiceCreate,
} from "../utils/loginCodes";

const serverTime = new Date().toISOString();

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    available: true,
    codeLength: 8,
    rotationSeconds: 30,
    graceSeconds: 60,
    ttlSeconds: 300,
    pollIntervalMs: 2000,
    approveRequiresPassword: false,
    serverTime,
    ...overrides,
  };
}

function fakeHttp() {
  const calls: { method: "get" | "post"; url: string }[] = [];
  return {
    calls,
    http: {
      get: vi.fn(async (url: string) => {
        calls.push({ method: "get", url });
        if (url.endsWith("/capabilities")) return { data: capabilities() };
        throw new Error(`unexpected GET ${url}`);
      }),
      post: vi.fn(async (url: string) => {
        calls.push({ method: "post", url });
        if (url.endsWith("/poll")) {
          return {
            data: {
              status: "approved",
              token: "httpOnly-cookie",
              user: { id: "u1", name: "ann" },
              expiresAt: serverTime,
              serverTime,
            },
          };
        }
        throw new Error(`unexpected POST ${url}`);
      }),
    },
  };
}

const storage = {
  setItem: vi.fn(),
  getItem: vi.fn(),
  removeItem: vi.fn(),
};

beforeEach(() => {
  storage.setItem.mockReset();
  storage.getItem.mockReset();
  storage.removeItem.mockReset();
  (globalThis as any).localStorage = storage;
});

describe("loginCodesServiceCreate", () => {
  it("targets the app login-code routes", async () => {
    const { http, calls } = fakeHttp();
    const service = loginCodesServiceCreate({ http });

    await expect(service.capabilities()).resolves.toMatchObject({
      enabled: true,
      available: true,
    });
    expect(LOGIN_CODES_BASE_URL).toBe("/api/users/login-codes");
    expect(calls).toContainEqual({
      method: "get",
      url: `${LOGIN_CODES_BASE_URL}/capabilities`,
    });
  });

  it("redeems through /poll without storing any token", async () => {
    const { http, calls } = fakeHttp();
    const service = loginCodesServiceCreate({ http });

    const result = await service.poll("request-token");
    expect(result).toMatchObject({ status: "approved" });
    expect(calls).toContainEqual({
      method: "post",
      url: `${LOGIN_CODES_BASE_URL}/poll`,
    });
    // Redemption sets the httpOnly cookie server-side: no session is persisted.
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("loginCodesIsAvailable", () => {
  it("is available when the server reports it enabled", async () => {
    const { http } = fakeHttp();
    await expect(
      loginCodesIsAvailable(loginCodesServiceCreate({ http })),
    ).resolves.toBe(true);
  });

  it("is unavailable when the flag is off", async () => {
    const http = {
      get: vi.fn(async () => ({
        data: capabilities({ enabled: false, available: false }),
      })),
      post: vi.fn(),
    };
    await expect(
      loginCodesIsAvailable(loginCodesServiceCreate({ http })),
    ).resolves.toBe(false);
  });

  it("is unavailable when the routes are missing", async () => {
    const http = {
      get: vi.fn(async () => {
        throw new Error("404");
      }),
      post: vi.fn(),
    };
    await expect(
      loginCodesIsAvailable(loginCodesServiceCreate({ http })),
    ).resolves.toBe(false);
  });
});
