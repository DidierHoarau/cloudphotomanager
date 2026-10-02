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
});
