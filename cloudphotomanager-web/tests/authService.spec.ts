import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { get: mocks.get, post: mocks.post },
}));

import { AuthService } from "../services/AuthService";

describe("AuthService", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.removeItem.mockReset();
    (globalThis as any).localStorage = { removeItem: mocks.removeItem };
  });

  it("validates the session against the API and clears the legacy token", async () => {
    mocks.get.mockResolvedValue({ status: 200 });
    await expect(AuthService.isAuthenticated()).resolves.toBe(true);
    expect(mocks.get).toHaveBeenCalledWith("/api/users/access/validate");
    // The pre-cookie localStorage token is removed, never read back.
    expect(mocks.removeItem).toHaveBeenCalledWith("auth_token");
  });

  it("reports unauthenticated when the API rejects", async () => {
    mocks.get.mockRejectedValue(new Error("403"));
    await expect(AuthService.isAuthenticated()).resolves.toBe(false);
  });

  it("getAuthHeader is a no-op because the cookie is sent automatically", async () => {
    await expect(AuthService.getAuthHeader()).resolves.toEqual({});
  });

  it("getSessionInfo returns the session endpoint payload", async () => {
    const payload = {
      isAuthenticated: true,
      userId: "u1",
      userName: "admin",
      permissions: { isAdmin: true },
    };
    mocks.get.mockResolvedValue({ data: payload });
    await expect(AuthService.getSessionInfo()).resolves.toEqual(payload);
  });

  it("logout calls the server logout endpoint to clear the httpOnly cookie", async () => {
    mocks.post.mockResolvedValue({});
    await AuthService.logout();
    expect(mocks.post).toHaveBeenCalledWith("/api/users/logout");
  });
});
