import * as jwt from "jsonwebtoken";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { UserPermissionData } from "./UserPermissionData";
import { Span } from "@opentelemetry/sdk-trace-base";

const logger = new Logger(path.basename(__filename));
let config: Config;

export async function AuthInit(context: Span, configIn: Config) {
  config = configIn;
  const span = StandardTracerStartSpan("Auth_init", context);
  const authKeyRaw = await SqlDbutils.querySQL(span, 'SELECT * FROM metadata WHERE type="auth_token"');
  if (authKeyRaw.length == 0) {
    configIn.JWT_KEY = uuidv4();
    await SqlDbutils.querySQL(span, 'INSERT INTO metadata (type, value, dateCreated) VALUES ("auth_token", ?, ?)', [
      configIn.JWT_KEY,
      new Date().toISOString(),
    ]);
  } else {
    configIn.JWT_KEY = authKeyRaw[0].value;
  }
  span.end();
}

export async function AuthGenerateJWT(context: Span, user: User): Promise<string> {
  const span = StandardTracerStartSpan("Auth_generateJWT", context);
  const userPermission = await UserPermissionData.getForUser(span, user.id);
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
      permissions: { isAdmin: userPermission.info.isAdmin },
    },
    config.JWT_KEY
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthMustBeAuthenticated(req: any, res: any): Promise<void> {
  let authenticated = false;
  if (req.headers.authorization) {
    try {
      jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      authenticated = true;
    } catch (err) {
      authenticated = false;
    }
  }
  if (!authenticated) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };
  if (req.headers.authorization) {
    try {
      const info = jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
      userSession.permissions = info.permissions;
    } catch (err) {
      logger.error(err);
    }
  }
  return userSession;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AuthIsTokenValid(token: string): boolean {
  try {
    jwt.verify(token, config.JWT_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

export function AuthIsAdmin(userSession: UserSession): boolean {
  if (userSession.permissions && userSession.permissions.isAdmin) {
    return true;
  }
  return false;
}
