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
