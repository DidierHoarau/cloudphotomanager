// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AuthorizeDeviceCard from "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue";

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
  return {
    capabilities: vi.fn(async () => capabilities()),
    preview: vi.fn(async () => ({
      deviceLabel: "Chrome on macOS",
      userAgent: "Mozilla/5.0",
      createdAt: serverTime,
      expiresAt: serverTime,
      userName: "ann",
      serverTime,
    })),
    approve: vi.fn(async () => ({
      approved: true,
      expiresAt: serverTime,
      serverTime,
    })),
    ...overrides,
  } as any;
}

describe("AuthorizeDeviceCard", () => {
  it("previews the requesting device and approves the sign-in", async () => {
    const svc = service();
    const wrapper = mount(AuthorizeDeviceCard, {
      props: { service: svc },
    });

    await flushPromises();
    const input = wrapper.find("input.login-code-input-field");
    await input.setValue("BCDFGHJK");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(svc.preview).toHaveBeenCalledWith(
      "BCDFGHJK",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(wrapper.text()).toContain("Chrome on macOS");
    expect(wrapper.text()).toContain("ann");

    await wrapper
      .find(".authorize-device-actions .authorize-device-button-primary")
      .trigger("click");
    await flushPromises();

    expect(svc.approve).toHaveBeenCalledWith(
      expect.objectContaining({ code: "BCDFGHJK" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(wrapper.emitted("approved")).toBeTruthy();
    wrapper.unmount();
  });

  it("shows the unavailable message and disables the form when the feature is off", async () => {
    const svc = service({
      capabilities: vi.fn(async () =>
        capabilities({ enabled: false, available: false }),
      ),
    });
    const wrapper = mount(AuthorizeDeviceCard, {
      props: { service: svc },
    });

    await flushPromises();
    expect(wrapper.text()).toContain("Login with a code is unavailable");
    expect(
      wrapper.find("button[type='submit']").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find("input.login-code-input-field").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
});
