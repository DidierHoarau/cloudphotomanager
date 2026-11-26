// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";

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

function service(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    capabilities: vi.fn(async () => capabilities()),
    create: vi.fn(async () => ({
      requestToken: "request-token",
      code: "BCDFGHJK",
      codeExpiresAt: new Date(now + 30_000).toISOString(),
      expiresAt: new Date(now + 300_000).toISOString(),
      serverTime,
    })),
    poll: vi.fn(async () => ({
      status: "approved",
      token: "httpOnly-cookie",
      user: { id: "u1", name: "ann" },
      expiresAt: serverTime,
      serverTime,
    })),
    cancel: vi.fn(async () => ({ status: "cancelled", serverTime })),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoginWithCodeCard", () => {
  it("shows the generated code and emits approved after a successful poll", async () => {
    const svc = service();
    const wrapper = mount(LoginWithCodeCard, {
      props: { service: svc },
    });

    await flushPromises();
    expect(wrapper.find(".login-with-code-value").text()).toContain(
      "BCDF-GHJK",
    );

    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(svc.poll).toHaveBeenCalledWith(
      "request-token",
      expect.objectContaining({ signal: expect.anything() }),
    );
    const approved = wrapper.emitted("approved");
    expect(approved).toBeTruthy();
    expect(approved?.[0]?.[0]).toMatchObject({
      token: "httpOnly-cookie",
      user: { id: "u1", name: "ann" },
    });
    wrapper.unmount();
  });

  it("renders an unavailable message and no code when the feature is off", async () => {
    const svc = service({
      capabilities: vi.fn(async () =>
        capabilities({ enabled: false, available: false }),
      ),
    });
    const wrapper = mount(LoginWithCodeCard, {
      props: { service: svc },
    });

    await flushPromises();
    expect(wrapper.text()).toContain("unavailable");
    expect(wrapper.find(".login-with-code-value").exists()).toBe(false);
    expect(svc.create).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
