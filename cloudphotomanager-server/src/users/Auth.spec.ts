import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as jwt from "jsonwebtoken";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import type { Config } from "../Config";
import { User } from "../model/User";

describe("Auth", () => {
  let span: Span;
  let dataDir: string;
  let config: Config;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let auth: typeof import("./Auth");
  let userData: typeof import("./UserData");

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-auth-spec-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("Auth.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    auth = await import("./Auth");
    userData = await import("./UserData");
    config = {
      DATA_DIR: dataDir,
      JWT_VALIDITY_DURATION: 3600,
      JWT_KEY: "",
      VERSION: "0.0.0",
    } as unknown as Config;
  });

  it("AuthInit initializes a JWT key on an empty database without failing", async () => {
    // Regression: the initialization path used to call the shared SQL helper
    // with a mismatched signature and crash before the key was stored.
    await expect(auth.AuthInit(span, config)).resolves.toBeUndefined();

    expect(config.JWT_KEY).toBeTruthy();
    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM metadata WHERE type='auth_token'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(config.JWT_KEY);
  });

  it("AuthInit is idempotent and reuses the stored key", async () => {
    const previousKey = config.JWT_KEY;
    await auth.AuthInit(span, config);
    expect(config.JWT_KEY).toBe(previousKey);

    // A config instance restarted with an empty key must pick up the stored
    // value (session tokens survive a server restart).
    const restartedConfig = { ...config, JWT_KEY: "" } as unknown as Config;
    await auth.AuthInit(span, restartedConfig);
    expect(restartedConfig.JWT_KEY).toBe(previousKey);
  });

  it("generates a JWT that AuthGetUserSession accepts via the Authorization header", async () => {
    const user = new User();
    user.name = "alice";
    const token = await auth.AuthGenerateJWT(span, user);
    const decoded = jwt.verify(token, config.JWT_KEY) as jwt.JwtPayload;
    expect(decoded.userId).toBe(user.id);
    expect(decoded.userName).toBe("alice");
    expect(decoded.permissions).toEqual({ isAdmin: false });

    const userSession = await auth.AuthGetUserSession({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(userSession.isAuthenticated).toBe(true);
    expect(userSession.userId).toBe(user.id);
  });

  it("accepts a valid signed session cookie", async () => {
    const user = new User();
    user.name = "bob";
    const token = await auth.AuthGenerateJWT(span, user);
    const userSession = await auth.AuthGetUserSession({
      headers: {},
      cookies: { token: "signed-value" },
      unsignCookie: () => ({ valid: true, value: token }),
    });
    expect(userSession.isAuthenticated).toBe(true);
    expect(userSession.userId).toBe(user.id);
  });

  it("rejects a cookie whose signature is invalid", async () => {
    const user = new User();
    const token = await auth.AuthGenerateJWT(span, user);
    const userSession = await auth.AuthGetUserSession({
      headers: {},
      cookies: { token: "tampered" },
      unsignCookie: () => ({ valid: false, value: token }),
    });
    expect(userSession.isAuthenticated).toBe(false);
  });

  it("rejects an expired or foreign token", async () => {
    const foreignToken = jwt.sign({ userId: "u1" }, "another-key", {
      expiresIn: 60,
    });
    const fromHeader = await auth.AuthGetUserSession({
      headers: { authorization: `Bearer ${foreignToken}` },
    });
    expect(fromHeader.isAuthenticated).toBe(false);

    const expiredToken = jwt.sign({ userId: "u1" }, config.JWT_KEY, {
      expiresIn: -10,
    });
    const expired = await auth.AuthGetUserSession({
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(expired.isAuthenticated).toBe(false);
  });

  it("returns an unauthenticated session when no credentials are present", async () => {
    const userSession = await auth.AuthGetUserSession({ headers: {} });
    expect(userSession.isAuthenticated).toBe(false);
    expect(userSession.userId).toBeUndefined();
  });

  it("AuthValidateWsRequest accepts the same credentials as the REST API", async () => {
    const user = new User();
    user.name = "carol";
    const token = await auth.AuthGenerateJWT(span, user);

    const fromHeader = await auth.AuthValidateWsRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fromHeader.isAuthenticated).toBe(true);
    expect(fromHeader.userId).toBe(user.id);

    const fromCookie = await auth.AuthValidateWsRequest({
      headers: {},
      cookies: { token: "signed-value" },
      unsignCookie: () => ({ valid: true, value: token }),
    });
    expect(fromCookie.isAuthenticated).toBe(true);
    expect(fromCookie.userId).toBe(user.id);

    const anonymous = await auth.AuthValidateWsRequest({ headers: {} });
    expect(anonymous.isAuthenticated).toBe(false);
  });

  describe("AuthSessionCookieOptions", () => {
    it("derives the cookie Max-Age from the JWT validity duration", () => {
      const options = auth.AuthSessionCookieOptions();
      expect(options.maxAge).toBe(config.JWT_VALIDITY_DURATION);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.signed).toBe(true);
      expect(options.path).toBe("/");
    });
  });

  describe("AuthRenewSessionIfDue", () => {
    let user: User;
    let setCookieCalls: any[][];

    const fakeRes = () => ({
      setCookie: (...args: any[]) => setCookieCalls.push(args),
    });

    const cookieReq = (token: string) => ({
      headers: {},
      cookies: { token: "signed-value" },
      unsignCookie: () => ({ valid: true, value: token }),
    });

    beforeEach(() => {
      setCookieCalls = [];
    });

    beforeAll(async () => {
      user = new User();
      user.name = "renewal";
      user.passwordEncrypted = "unused";
      await userData.UserDataAdd(span, user);
    });

    it("re-issues a fresh cookie for a cookie session older than half the validity", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const agedToken = jwt.sign(
        {
          iat: nowSeconds - 2000, // older than JWT_VALIDITY_DURATION / 2
          exp: nowSeconds + 1600,
          userId: user.id,
          userName: user.name,
        },
        config.JWT_KEY,
      );

      await auth.AuthRenewSessionIfDue(span, cookieReq(agedToken), fakeRes());

      expect(setCookieCalls).toHaveLength(1);
      const [name, freshToken, options] = setCookieCalls[0];
      expect(name).toBe("token");
      expect(options).toEqual(auth.AuthSessionCookieOptions());
      const freshInfo = jwt.verify(
        freshToken,
        config.JWT_KEY,
      ) as jwt.JwtPayload;
      expect(freshInfo.userId).toBe(user.id);
      expect(freshInfo.iat).toBeGreaterThan(nowSeconds - 2000);
    });

    it("does not renew a fresh cookie session", async () => {
      const token = await auth.AuthGenerateJWT(span, user);
      await auth.AuthRenewSessionIfDue(span, cookieReq(token), fakeRes());
      expect(setCookieCalls).toHaveLength(0);
    });

    it("does not touch Authorization-header clients", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const agedToken = jwt.sign(
        { iat: nowSeconds - 2000, exp: nowSeconds + 1600, userId: user.id },
        config.JWT_KEY,
      );
      const req = {
        headers: { authorization: `Bearer ${agedToken}` },
        cookies: { token: "signed-value" },
        unsignCookie: () => ({ valid: true, value: agedToken }),
      };
      await auth.AuthRenewSessionIfDue(span, req, fakeRes());
      expect(setCookieCalls).toHaveLength(0);
    });

    it("does nothing without credentials or with an invalid cookie", async () => {
      await auth.AuthRenewSessionIfDue(span, { headers: {} }, fakeRes());
      expect(setCookieCalls).toHaveLength(0);

      const invalidReq = {
        headers: {},
        cookies: { token: "tampered" },
        unsignCookie: () => ({ valid: false, value: "anything" }),
      };
      await auth.AuthRenewSessionIfDue(span, invalidReq, fakeRes());
      expect(setCookieCalls).toHaveLength(0);
    });

    it("does not renew for a user that no longer exists", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ghostToken = jwt.sign(
        { iat: nowSeconds - 2000, exp: nowSeconds + 1600, userId: "ghost" },
        config.JWT_KEY,
      );
      await auth.AuthRenewSessionIfDue(
        span,
        cookieReq(ghostToken),
        fakeRes(),
      );
      expect(setCookieCalls).toHaveLength(0);
    });
  });
});
