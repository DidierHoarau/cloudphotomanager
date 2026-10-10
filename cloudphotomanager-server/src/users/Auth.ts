import { Span } from "@opentelemetry/sdk-trace-base";
import * as jwt from "jsonwebtoken";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { UserDataGet } from "./UserData";
import { UserPermissionDataGetForUser } from "./UserPermissionData";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));
let config: Config;

export async function AuthInit(context: Span, configIn: Config) {
  config = configIn;
  const span = OTelTracer().startSpan("Auth_init", context);
  try {
    const authKeyRaw = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM metadata WHERE type='auth_token'",
    );
    if (authKeyRaw.length == 0) {
      configIn.JWT_KEY = uuidv4();
      await SqlDbUtilsExecSQL(
        span,
        "INSERT INTO metadata (type, value, dateCreated) VALUES ('auth_token', ?, ?)",
        [configIn.JWT_KEY, new Date().toISOString()],
      );
    } else {
      configIn.JWT_KEY = authKeyRaw[0].value;
    }
  } finally {
    span.end();
  }
}

export async function AuthGenerateJWT(
  context: Span,
  user: User,
): Promise<string> {
  const span = OTelTracer().startSpan("Auth_generateJWT", context);
  try {
    const userPermission = await UserPermissionDataGetForUser(span, user.id);
    return jwt.sign(
      {
        exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
        userId: user.id,
        userName: user.name,
        permissions: { isAdmin: userPermission.info.isAdmin },
      },
      config.JWT_KEY,
    );
  } finally {
    span.end();
  }
}

export async function AuthMustBeAuthenticated(
  req: any,
  res: any,
): Promise<void> {
  let authenticated = false;
  if (req.headers.authorization) {
    try {
      jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  if (!authenticated) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };

  // The Authorization header wins (API clients); otherwise the signed
  // httpOnly session cookie is used (web app). `req.unsignCookie` is provided
  // by @fastify/cookie.
  let token: string | undefined;
  if (req.headers?.authorization) {
    token = req.headers.authorization.split(" ")[1];
  } else {
    try {
      const signedToken = req.cookies?.token;
      if (signedToken && typeof req.unsignCookie === "function") {
        const unsigned = req.unsignCookie(signedToken);
        if (unsigned?.valid) {
          token = unsigned.value;
        }
      }
    } catch {
      token = undefined;
    }
  }

  if (token) {
    try {
      const info = jwt.verify(token, config.JWT_KEY) as jwt.JwtPayload;
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
      userSession.permissions = info.permissions;
    } catch (err) {
      logger.error("Error Getting User Session", err);
    }
  }
  return userSession;
}
 
// Validates a WebSocket upgrade request with the same credentials as the
// REST API (Authorization header win, else signed session cookie). The web
// app relies on the cookie sent with the same-origin handshake; tokens are
// no longer accepted from the query string.
export async function AuthValidateWsRequest(req: any): Promise<UserSession> {
  return AuthGetUserSession(req);
}

export function AuthIsAdmin(userSession: UserSession): boolean {
  if (userSession.permissions && userSession.permissions.isAdmin) {
    return true;
  }
  return false;
}

// Session cookie: not readable by JavaScript (httpOnly) so a XSS cannot
// exfiltrate the session; lax same-site keeps the SPA same-origin flows;
// maxAge (seconds, like JWT_VALIDITY_DURATION) makes the cookie persistent
// across browser restarts and aligned with the JWT validity.
export function AuthSessionCookieOptions() {
  return {
    path: "/",
    signed: true,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: config.JWT_VALIDITY_DURATION,
  };
}

// Sliding renewal for browser sessions: when a cookie-authenticated request
// carries a token older than half of JWT_VALIDITY_DURATION, re-issue a fresh
// JWT and refresh the persistent cookie so an actively used session never
// expires. Authorization-header clients are left untouched (they re-POST
// /session for fresh tokens).
export async function AuthRenewSessionIfDue(
  context: Span,
  req: any,
  res: any,
): Promise<void> {
  if (req.headers?.authorization) {
    return;
  }
  let token: string | undefined;
  try {
    const signedToken = req.cookies?.token;
    if (signedToken && typeof req.unsignCookie === "function") {
      const unsigned = req.unsignCookie(signedToken);
      if (unsigned?.valid) {
        token = unsigned.value;
      }
    }
  } catch {
    return;
  }
  if (!token) {
    return;
  }
  let info: jwt.JwtPayload;
  try {
    info = jwt.verify(token, config.JWT_KEY) as jwt.JwtPayload;
  } catch {
    return;
  }
  // jsonwebtoken stamps `iat` at signing time; renew once the token is older
  // than half of its validity.
  if (!info.iat) {
    return;
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - info.iat;
  if (ageSeconds < config.JWT_VALIDITY_DURATION / 2) {
    return;
  }
  const user = await UserDataGet(context, info.userId);
  if (!user) {
    return;
  }
  const freshToken = await AuthGenerateJWT(context, user);
  (res as any).setCookie("token", freshToken, AuthSessionCookieOptions());
}
