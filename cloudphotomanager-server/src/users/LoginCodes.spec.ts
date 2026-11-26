import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import cookie from "@fastify/cookie";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import Fastify, { FastifyInstance } from "fastify";
import type { Config } from "../Config";
import { User } from "../model/User";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { AuthGenerateJWT, AuthGetUserSession, AuthInit } from "./Auth";
import {
  LOGIN_CODE_COOKIE_SENTINEL,
  LoginCodesBuildRoutesOptions,
  LoginCodesBuildSettings,
  LoginCodesEventForLog,
  LoginCodesLogEvent,
  LoginCodesMount,
} from "./LoginCodes";
import { UserDataAdd } from "./UserData";
import { UserPasswordSetPassword } from "./UserPassword";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-login-codes-"));
const SQL_DIR = path.resolve(__dirname, "../../sql");
const PASSWORD = "correct-password";
const PREFIX = "/api/users/login-codes";
const CHROME_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let config: Config;
let user: User;

async function bearerFor(userIn: User): Promise<string> {
  return `Bearer ${await AuthGenerateJWT(undefined, userIn)}`;
}

async function newUser(name: string): Promise<User> {
  const created = new User();
  created.name = name;
  await UserPasswordSetPassword(undefined, created, PASSWORD);
  await UserDataAdd(undefined, created);
  return created;
}

async function buildApp(enabled = true): Promise<FastifyInstance> {
  // Separate object per app so the flag override never leaks between tests.
  const appConfig = {
    ...config,
    LOGIN_CODE_ENABLED: enabled,
  } as unknown as Config;
  const app = Fastify({ trustProxy: "loopback" });
  await app.register(cookie, {
    secret: config.JWT_KEY,
    parseOptions: {},
  } as any);
  app.get("/whoami", async (req) => AuthGetUserSession(req));
  await LoginCodesMount(app, appConfig);
  await app.ready();
  return app;
}

function signedCookie(app: FastifyInstance, token: string): string {
  return `token=${app.signCookie(token)}`;
}

function firstCookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : String(raw ?? "");
  return value.split(";")[0];
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("LOGIN_CODE_")) {
      delete process.env[key];
    }
  }
  await fs.remove(DATA_DIR);
  await fs.ensureDir(DATA_DIR);
  const tracer = new StandardTracer({
    SERVICE_ID: "cloudphotomanager-server-test",
    VERSION: "0.0.0",
  });
  OTelSetTracer(tracer);
  SqlDbUtilsSetOTel(tracer, new StandardLogger());
  const span = OTelTracer().startSpan("LoginCodes.spec");
  await SqlDbUtilsInit(span, { DATA_DIR }, SQL_DIR);
  config = {
    DATA_DIR,
    JWT_VALIDITY_DURATION: 3600,
    JWT_KEY: "",
  } as unknown as Config;
  // AuthInit generates and persists JWT_KEY when unset, exactly like boot.
  await AuthInit(span, config);
  user = await newUser("ann");
});

afterAll(async () => {
  const db = SqlDbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
  await fs.remove(DATA_DIR);
});

beforeEach(() => {
  SqlDbUtilsExecSQL(undefined, 'DELETE FROM "users_login_codes"');
});

describe("LoginCodesBuildSettings", () => {
  it("should default to the protocol settings with the feature disabled", () => {
    const settings = LoginCodesBuildSettings({} as Config);
    expect(settings).toMatchObject({
      enabled: false,
      ttlSeconds: 300,
      rotationSeconds: 30,
      graceSeconds: 60,
      pollIntervalMs: 2000,
      maxAttempts: 5,
      approveRequiresPassword: false,
    });
  });
});

describe("LoginCodesEventForLog", () => {
  it("should keep only allow-listed fields and drop smuggled secrets", () => {
    const sanitized = LoginCodesEventForLog({
      type: "login_code_approved",
      requestId: "req-1",
      userId: "user-1",
      userName: "ann",
      deviceLabel: "Chrome on macOS",
      reason: "attempts_exceeded",
      ip: "203.0.113.4",
      // Secrets smuggled into the event must never be written out.
      code: "BCDFGHJK",
      requestToken: "raw-request-token",
      token: "a.jwt.token",
    } as never);
    expect(sanitized).toEqual({
      type: "login_code_approved",
      requestId: "req-1",
      userId: "user-1",
      userName: "ann",
      deviceLabel: "Chrome on macOS",
      reason: "attempts_exceeded",
      ip: "203.0.113.4",
    });
  });

  it("should not write a code or token to the log", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      LoginCodesLogEvent({
        type: "login_code_consumed",
        requestId: "req-2",
        code: "BCDFGHJK",
        requestToken: "raw-request-token",
      } as never);
      const output = String(spy.mock.calls[0][0]);
      expect(output).toContain("[LoginCodes]");
      expect(output).not.toContain("BCDFGHJK");
      expect(output).not.toContain("raw-request-token");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("LoginCodesBuildRoutesOptions", () => {
  it("should resolve an interactive JWT approver via Bearer", async () => {
    const options = LoginCodesBuildRoutesOptions(config);
    const approver = await options.getApprovingUser({
      headers: { authorization: await bearerFor(user) },
    } as never);
    expect(approver).toEqual({ id: user.id, name: user.name });
  });

  it("should return null without a session or with a forged credential", async () => {
    const options = LoginCodesBuildRoutesOptions(config);
    expect(await options.getApprovingUser({ headers: {} } as never)).toBeNull();
    expect(
      await options.getApprovingUser({
        headers: { authorization: "Bearer not-a-jwt" },
      } as never),
    ).toBeNull();
  });

  it("should issue a session with the password-login claims", async () => {
    const options = LoginCodesBuildRoutesOptions(config);
    const session = await options.issueSession(
      { id: user.id, name: user.name },
      {} as never,
    );
    expect(session.user).toEqual({ id: user.id, name: user.name });
    expect(session.user).not.toHaveProperty("passwordEncrypted");
    const verified = await AuthGetUserSession({
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(verified.isAuthenticated).toBe(true);
    expect(verified.userId).toBe(user.id);
  });
});

describe("login-code routes", () => {
  it("should advertise the enabled feature without caching", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: `${PREFIX}/capabilities`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        enabled: true,
        available: true,
        codeLength: 8,
        rotationSeconds: 30,
        graceSeconds: 60,
        ttlSeconds: 300,
        pollIntervalMs: 2000,
        approveRequiresPassword: false,
      });
    } finally {
      await app.close();
    }
  });

  it("should not mount the routes when the feature is disabled", async () => {
    const app = await buildApp(false);
    try {
      const response = await app.inject({
        method: "GET",
        url: `${PREFIX}/capabilities`,
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("should require an interactive session to preview and approve", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST",
        url: `${PREFIX}/`,
        payload: {},
        headers: { "user-agent": CHROME_MAC_UA },
      });
      expect(created.statusCode).toBe(201);
      const code = created.json().code;

      const anonymous = await app.inject({
        method: "POST",
        url: `${PREFIX}/preview`,
        payload: { code },
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().code).toBe("UNAUTHENTICATED");

      const badJwt = await app.inject({
        method: "POST",
        url: `${PREFIX}/preview`,
        payload: { code },
        headers: { authorization: "Bearer not-a-jwt" },
      });
      expect(badJwt.statusCode).toBe(401);

      const nonJwt = await app.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code },
        headers: { "x-upload-token": "an-upload-token" },
      });
      expect(nonJwt.statusCode).toBe(401);
      expect(nonJwt.json().code).toBe("UNAUTHENTICATED");
    } finally {
      await app.close();
    }
  });

  it("should redeem through the session cookie and set the token as an httpOnly cookie", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST",
        url: `${PREFIX}/`,
        payload: {},
        headers: { "user-agent": CHROME_MAC_UA },
      });
      expect(created.statusCode).toBe(201);
      const { code, requestToken } = created.json();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);

      const sessionCookie = signedCookie(app, await AuthGenerateJWT(undefined, user));
      const preview = await app.inject({
        method: "POST",
        url: `${PREFIX}/preview`,
        payload: { code },
        headers: { cookie: sessionCookie },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({
        deviceLabel: "Chrome on macOS",
        userName: user.name,
      });

      const approve = await app.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code },
        headers: { cookie: sessionCookie },
      });
      expect(approve.statusCode).toBe(200);
      expect(approve.json().approved).toBe(true);

      const polled = await app.inject({
        method: "POST",
        url: `${PREFIX}/poll`,
        payload: { requestToken },
      });
      expect(polled.statusCode).toBe(200);
      expect(polled.headers["cache-control"]).toBe("no-store");
      const redeemed = polled.json();
      expect(redeemed.status).toBe("approved");
      expect(redeemed.user).toEqual({ id: user.id, name: user.name });
      // The JWT is only in the httpOnly cookie; the body carries a sentinel.
      expect(redeemed.token).toBe(LOGIN_CODE_COOKIE_SENTINEL);
      const setCookie = String(polled.headers["set-cookie"]);
      expect(setCookie).toContain("token=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");

      // The redeemed cookie is a valid application session.
      const whoami = await app.inject({
        method: "GET",
        url: "/whoami",
        headers: { cookie: firstCookieHeader(polled) },
      });
      expect(whoami.json()).toMatchObject({
        isAuthenticated: true,
        userId: user.id,
      });
    } finally {
      await app.close();
    }
  });

  it("should approve with a Bearer JWT and still cookie the new device", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST",
        url: `${PREFIX}/`,
        payload: {},
        headers: { "user-agent": CHROME_MAC_UA },
      });
      const { code, requestToken } = created.json();
      const authorization = await bearerFor(user);

      const approve = await app.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code },
        headers: { authorization },
      });
      expect(approve.statusCode).toBe(200);

      const polled = await app.inject({
        method: "POST",
        url: `${PREFIX}/poll`,
        payload: { requestToken },
      });
      expect(polled.statusCode).toBe(200);
      expect(polled.json().status).toBe("approved");
      expect(polled.json().token).toBe(LOGIN_CODE_COOKIE_SENTINEL);
      expect(String(polled.headers["set-cookie"])).toContain("token=");

      const reuse = await app.inject({
        method: "POST",
        url: `${PREFIX}/poll`,
        payload: { requestToken },
      });
      expect(reuse.statusCode).toBe(409);
      expect(reuse.json().code).toBe("ALREADY_USED");
    } finally {
      await app.close();
    }
  });

  it("should fail closed when the approver was deleted before redemption", async () => {
    const app = await buildApp();
    try {
      const doomed = await newUser("doomed");
      const created = await app.inject({
        method: "POST",
        url: `${PREFIX}/`,
        payload: {},
        headers: { "user-agent": CHROME_MAC_UA },
      });
      const { code, requestToken } = created.json();
      const approve = await app.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code },
        headers: { authorization: await bearerFor(doomed) },
      });
      expect(approve.statusCode).toBe(200);

      SqlDbUtilsExecSQL(undefined, "DELETE FROM users WHERE id=?", [doomed.id]);

      const polled = await app.inject({
        method: "POST",
        url: `${PREFIX}/poll`,
        payload: { requestToken },
      });
      expect(polled.statusCode).toBe(200);
      expect(polled.json().status).toBe("failed");
      expect(polled.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
