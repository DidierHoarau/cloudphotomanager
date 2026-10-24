import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance } from "fastify";
import { User } from "../model/User";
import { UserPermission } from "../model/UserPermission";
import {
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthIsAdmin,
  AuthRenewSessionIfDue,
  AuthSessionCookieOptions,
} from "./Auth";
import {
  UserDataAddStatement,
  UserDataBumpTokenVersion,
  UserDataDeleteStatement,
  UserDataGet,
  UserDataGetByName,
  UserDataList,
  UserDataUpdate,
} from "./UserData";
import {
  UserPasswordCheckPassword,
  UserPasswordSetPassword,
} from "./UserPassword";
import { UserPasswordValidate } from "./UserPasswordPolicy";
import {
  UserPermissionDataCountAdmins,
  UserPermissionDataDeleteForUserStatement,
  UserPermissionDataGetForUser,
  UserPermissionDataUpdateForUser,
  UserPermissionDataUpdateForUserStatement,
} from "./UserPermissionData";
import { UserPermissionInfoValidate } from "./UserPermissionValidation";
import { LoginThrottleHit } from "./LoginThrottle";
import { SyncRoutesCloseUserSockets } from "../sync/SyncRoutes";
import { SqlDbUtilsGetDatabase } from "@devopsplaybook.io/common-utils";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("UserRoutes");

const LOGIN_MAX_ATTEMPTS = 20;
const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;

export class UserRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status/initialization", async (req, res) => {
      const span = OTelRequestSpan(req);
      if ((await UserDataList(span)).length === 0) {
        res.status(201).send({ initialized: false });
      } else {
        res.status(201).send({ initialized: true });
      }
    });

    fastify.post<{
      Body: {
        name: string;
        password: string;
      };
    }>("/session", async (req, res) => {
      const span = OTelRequestSpan(req);
      let user: User;
      // From token
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        user = await UserDataGet(span, userSession.userId);
        const token = await AuthGenerateJWT(span, user);
        (res as any).setCookie("token", token, AuthSessionCookieOptions());
        // Do not echo the token when the session came from the httpOnly
        // cookie: a script calling this endpoint would otherwise be able to
        // read a usable bearer token back out. API clients using the
        // Authorization header keep receiving it.
        if (req.headers?.authorization) {
          return res.status(201).send({ success: true, token });
        }
        return res.status(201).send({ success: true });
      }

      // From User/Pass
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      // Throttle keyed by IP + lowercased name: a single account cannot be
      // brute-forced even when the attacker rotates IPs partially, and a
      // shared IP does not lock out other users.
      const throttle = LoginThrottleHit(
        `login:${req.ip || "unknown"}:${req.body.name.toLowerCase()}`,
        LOGIN_MAX_ATTEMPTS,
      );
      if (!throttle.allowed) {
        logger.warn(
          `Login throttled for ${req.body.name} from ${req.ip || "unknown"}`,
          span,
        );
        res.header("Retry-After", String(throttle.retryAfterSeconds));
        return res.status(429).send({ error: "Too Many Attempts" });
      }
      user = await UserDataGetByName(span, req.body.name);
      if (!user) {
        logger.warn(
          `Login failed for unknown user ${req.body.name} from ${req.ip || "unknown"}`,
          span,
        );
        return res.status(403).send({ error: "Authentication Failed" });
      } else if (
        await UserPasswordCheckPassword(span, user, req.body.password)
      ) {
        const token = await AuthGenerateJWT(span, user);
        (res as any).setCookie("token", token, AuthSessionCookieOptions());
        return res.status(201).send({ success: true, token });
      } else {
        logger.warn(
          `Login failed for ${req.body.name} from ${req.ip || "unknown"}`,
          span,
        );
        return res.status(403).send({ error: "Authentication Failed" });
      }
    });

    // Current session info (cookie or Authorization header). Used by the web
    // app to know who is logged in and whether the user is an admin.
    fastify.get("/session", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      // Sliding renewal: refresh the persistent cookie when the token is due.
      await AuthRenewSessionIfDue(span, req, res);
      return res.status(200).send({
        isAuthenticated: true,
        userId: userSession.userId,
        userName: userSession.userName,
        permissions: userSession.permissions,
      });
    });

    // Clears the session cookie and revokes every token issued to the user:
    // a copied JWT stops working as soon as the logout has been processed.
    fastify.post("/logout", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        await UserDataBumpTokenVersion(span, userSession.userId);
        SyncRoutesCloseUserSockets(userSession.userId);
      }
      (res as any).clearCookie("token", { path: "/" });
      return res.status(200).send({});
    });

    fastify.get("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      res.status(201).send({ users: await UserDataList(span) });
    });

    fastify.post<{
      Body: {
        name: string;
        password: string;
      };
    }>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      let isInitialized = true;
      if ((await UserDataList(span)).length === 0) {
        isInitialized = false;
      }
      const userSession = await AuthGetUserSession(req);
      if (isInitialized && !AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const newUser = new User();
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const passwordError = UserPasswordValidate(req.body.password);
      if (passwordError) {
        return res.status(400).send({ error: passwordError });
      }
      if (await UserDataGetByName(span, req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }
      let isAdmin = false;
      if (!isInitialized) {
        isAdmin = true;
      }
      newUser.name = req.body.name;
      await UserPasswordSetPassword(span, newUser, req.body.password);
      const userPermission = new UserPermission();
      userPermission.userId = newUser.id;
      userPermission.info.isAdmin = isAdmin;
      // The user and its permission row must be created atomically.
      const apply = SqlDbUtilsGetDatabase().transaction(() => {
        UserDataAddStatement(span, newUser);
        UserPermissionDataUpdateForUserStatement(
          span,
          newUser.id,
          userPermission,
        );
      });
      apply();
      res.status(201).send({});
    });

    fastify.delete<{
      Params: {
        userId: string;
      };
    }>("/:userId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (req.params.userId === userSession.userId) {
        return res
          .status(403)
          .send({ error: "Cannot delete the current user" });
      }
      const target = await UserDataGet(span, req.params.userId);
      if (!target) {
        return res.status(404).send({ error: "Not Found" });
      }
      const targetPermission = await UserPermissionDataGetForUser(
        span,
        req.params.userId,
      );
      if (
        targetPermission?.info?.isAdmin === true &&
        (await UserPermissionDataCountAdmins(span)) <= 1
      ) {
        return res.status(403).send({ error: "Cannot delete the last admin" });
      }
      // The user and its permission row must be deleted atomically.
      const applyDelete = SqlDbUtilsGetDatabase().transaction(() => {
        UserDataDeleteStatement(span, req.params.userId);
        UserPermissionDataDeleteForUserStatement(span, req.params.userId);
      });
      applyDelete();
      SyncRoutesCloseUserSockets(req.params.userId);
      res.status(202).send({});
    });

    fastify.put<{
      Body: {
        password: string;
        passwordOld: string;
      };
    }>("/password", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const throttle = LoginThrottleHit(
        `password:${userSession.userId}`,
        PASSWORD_CHANGE_MAX_ATTEMPTS,
      );
      if (!throttle.allowed) {
        res.header("Retry-After", String(throttle.retryAfterSeconds));
        return res.status(429).send({ error: "Too Many Attempts" });
      }
      const user = await UserDataGet(span, userSession.userId);
      if (!user) {
        return res.status(404).send({ error: "Not Found" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const passwordError = UserPasswordValidate(req.body.password);
      if (passwordError) {
        return res.status(400).send({ error: passwordError });
      }
      if (
        !(await UserPasswordCheckPassword(span, user, req.body.passwordOld))
      ) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(span, user, req.body.password);
      await UserDataUpdate(span, user);
      // Changing the password revokes every existing session, then the
      // caller gets a fresh credential so it stays logged in.
      await UserDataBumpTokenVersion(span, user.id);
      SyncRoutesCloseUserSockets(user.id);
      const refreshed = await UserDataGet(span, user.id);
      const token = await AuthGenerateJWT(span, refreshed);
      (res as any).setCookie("token", token, AuthSessionCookieOptions());
      if (req.headers?.authorization) {
        return res.status(201).send({ token });
      }
      return res.status(201).send({});
    });

    fastify.get<{
      Params: {
        userId: string;
      };
    }>("/:userId/permissions", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserDataGet(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      res
        .status(200)
        .send(await UserPermissionDataGetForUser(span, req.params.userId));
    });

    fastify.put<{
      Params: {
        userId: string;
      };
      Body: {
        info: any;
      };
    }>("/:userId/permissions", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserDataGet(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      const validation = await UserPermissionInfoValidate(span, req.body?.info);
      if (!validation.info) {
        return res.status(400).send({ error: validation.error });
      }
      const currentPermission = await UserPermissionDataGetForUser(
        span,
        req.params.userId,
      );
      if (
        currentPermission?.info?.isAdmin === true &&
        validation.info.isAdmin === false &&
        (await UserPermissionDataCountAdmins(span)) <= 1
      ) {
        return res
          .status(403)
          .send({ error: "Cannot demote the last admin" });
      }
      const permissions = await UserPermissionDataGetForUser(
        span,
        req.params.userId,
      );
      permissions.info = validation.info;
      await UserPermissionDataUpdateForUser(
        span,
        req.params.userId,
        permissions,
      );
      // A permission change revokes the target's sessions so a demoted admin
      // or a user whose grants were removed cannot keep the old context.
      await UserDataBumpTokenVersion(span, req.params.userId);
      SyncRoutesCloseUserSockets(req.params.userId);
      if (req.params.userId === userSession.userId) {
        const refreshed = await UserDataGet(span, userSession.userId);
        const token = await AuthGenerateJWT(span, refreshed);
        (res as any).setCookie("token", token, AuthSessionCookieOptions());
        if (req.headers?.authorization) {
          return res.status(201).send({ token });
        }
      }
      res.status(201).send({});
    });

    fastify.get("/access/validate", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      // Sliding renewal: the web auth middleware calls this endpoint on every
      // navigation, so an actively used session keeps rolling forward.
      await AuthRenewSessionIfDue(span, req, res);
      res.status(200).send({});
    });
  }
}
