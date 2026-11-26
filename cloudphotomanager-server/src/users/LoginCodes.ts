import {
  LoginCodesOptionsFromConfig,
  LoginCodesRoutes,
  createLoginCodesStoreCommonUtils,
  type LoginCodesEvent,
  type LoginCodesRoutesOptions,
  type LoginCodesSettings,
  type LoginCodesStore,
} from "@devopsplaybook.io/common-utils";
import type { FastifyInstance } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { Config } from "../Config";
import { OTelLogger } from "../OTelContext";
import {
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthSessionCookieOptions,
} from "./Auth";
import { UserDataGet } from "./UserData";
import { UserPasswordCheckPassword } from "./UserPassword";

const logger = OTelLogger().createModuleLogger("LoginCodes");

export const LOGIN_CODES_PREFIX = "/api/users/login-codes";

// Non-secret placeholder returned in the approved poll body. The real JWT is
// only ever written to the httpOnly cookie; common-web only requires the
// `token` field to be a string, so no JS-readable credential is introduced.
export const LOGIN_CODE_COOKIE_SENTINEL = "httpOnly-cookie";

/** Apply the LOGIN_CODE_* defaults/clamps read from this app's config. */
export function LoginCodesBuildSettings(config: Config): LoginCodesSettings {
  return LoginCodesOptionsFromConfig(config);
}

/** Allow-listed audit fields only: never a code, request token or JWT. */
export function LoginCodesEventForLog(event: LoginCodesEvent): Record<string, unknown> {
  return {
    type: event.type,
    requestId: event.requestId,
    userId: event.userId,
    userName: event.userName,
    deviceLabel: event.deviceLabel,
    reason: event.reason,
    ip: event.ip,
  };
}

export function LoginCodesLogEvent(event: LoginCodesEvent): void {
  logger.info("[LoginCodes] " + JSON.stringify(LoginCodesEventForLog(event)));
}

/**
 * Build the `LoginCodesRoutes` options: the DB-backed store, an approver
 * resolved from this app's own session (signed cookie or Bearer JWT), a
 * session issuer matching the password login, the bcrypt password check and
 * the sanitised event log.
 */
export function LoginCodesBuildRoutesOptions(
  config: Config,
  store: LoginCodesStore = createLoginCodesStoreCommonUtils(),
): LoginCodesRoutesOptions {
  return {
    ...LoginCodesBuildSettings(config),
    store,
    // Lazy: AuthInit() has populated JWT_KEY by the first request. An empty
    // key makes the feature answer 503, never a boot crash.
    hashKey: () => config.JWT_KEY,
    getApprovingUser: async (req) => {
      // Only this app's own session is a credential (cookie or Bearer JWT);
      // anonymous or forged values resolve to null and the route answers 401.
      const session = await AuthGetUserSession(req);
      if (!session.isAuthenticated) {
        return null;
      }
      const user = await UserDataGet(OTelRequestSpan(req), session.userId);
      return user ? { id: user.id, name: user.name } : null;
    },
    getUserById: async (id) => {
      const user = await UserDataGet(undefined, id);
      return user ? { id: user.id, name: user.name } : null;
    },
    issueSession: async (approver) => {
      // Re-read live: a deleted approver aborts redemption (fail closed).
      const user = await UserDataGet(undefined, approver.id);
      if (!user) {
        throw new Error("Login code approver no longer exists");
      }
      return {
        token: await AuthGenerateJWT(undefined, user), // same claims as password login
        user: { id: user.id, name: user.name }, // never passwordEncrypted
      };
    },
    verifyPassword: async (approver, password) => {
      const user = await UserDataGet(undefined, approver.id);
      return user ? UserPasswordCheckPassword(undefined, user, password) : false;
    },
    onEvent: LoginCodesLogEvent,
  };
}

/**
 * Mount the login-code routes, gated at boot on `LOGIN_CODE_ENABLED`.
 *
 * The redemption response must leave the device with the same signed,
 * httpOnly session cookie a password login sets (the web app never sees a
 * token). The protocol plugin sends the JWT in the `POST /poll` body, so a
 * scoped `onSend` hook moves it into the cookie with
 * `AuthSessionCookieOptions()` and replaces the body value with a non-secret
 * sentinel; `no-store` headers are still added by the plugin's own hook.
 */
export async function LoginCodesMount(
  fastify: FastifyInstance,
  config: Config,
): Promise<void> {
  // Boot-time gate: when off, the routes do not exist at all.
  if (!config.LOGIN_CODE_ENABLED) {
    return;
  }
  await fastify.register(
    async (instance) => {
      instance.addHook("onSend", async (request, reply, payload) => {
        const pathname = (request.url || "").split("?")[0];
        if (
          request.method !== "POST" ||
          !pathname.endsWith(`${LOGIN_CODES_PREFIX}/poll`)
        ) {
          return payload;
        }
        if (typeof payload !== "string") {
          return payload;
        }
        let body: any;
        try {
          body = JSON.parse(payload);
        } catch {
          return payload;
        }
        if (body?.status !== "approved" || typeof body.token !== "string") {
          return payload;
        }
        (reply as any).setCookie(
          "token",
          body.token,
          AuthSessionCookieOptions(),
        );
        body.token = LOGIN_CODE_COOKIE_SENTINEL;
        return JSON.stringify(body);
      });
      await LoginCodesRoutes(instance, LoginCodesBuildRoutesOptions(config));
    },
    { prefix: LOGIN_CODES_PREFIX },
  );
}
