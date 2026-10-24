import { LoginThrottleHit, LoginThrottleReset } from "./LoginThrottle";

describe("LoginThrottle", () => {
  beforeEach(() => {
    LoginThrottleReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    LoginThrottleReset();
  });

  it("allows attempts up to the limit and then blocks with a retry hint", () => {
    for (let i = 0; i < 3; i++) {
      expect(LoginThrottleHit("login:ip:user", 3)).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }
    const blocked = LoginThrottleHit("login:ip:user", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("tracks each key independently", () => {
    expect(LoginThrottleHit("login:ip-a:user", 1).allowed).toBe(true);
    expect(LoginThrottleHit("login:ip-a:user", 1).allowed).toBe(false);
    expect(LoginThrottleHit("login:ip-b:user", 1).allowed).toBe(true);
    expect(LoginThrottleHit("password:user-1", 1).allowed).toBe(true);
  });

  it("opens a new window once the previous one elapsed", () => {
    expect(LoginThrottleHit("login:ip:user", 1, 60).allowed).toBe(true);
    expect(LoginThrottleHit("login:ip:user", 1, 60).allowed).toBe(false);

    jest.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(LoginThrottleHit("login:ip:user", 1, 60).allowed).toBe(true);
  });
});
