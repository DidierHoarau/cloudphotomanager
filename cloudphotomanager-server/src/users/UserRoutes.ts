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
import {
  UserPermissionDataDeleteForUserStatement,
  UserPermissionDataGetForUser,
  UserPermissionDataUpdateForUser,
  UserPermissionDataUpdateForUserStatement,
} from "./UserPermissionData";
import { SqlDbUtilsGetDatabase } from "@devopsplaybook.io/common-utils";

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
      user = await UserDataGetByName(span, req.body.name);
      if (!user) {
        return res.status(403).send({ error: "Authentication Failed" });
      } else if (
        await UserPasswordCheckPassword(span, user, req.body.password)
      ) {
        const token = await AuthGenerateJWT(span, user);
        (res as any).setCookie("token", token, AuthSessionCookieOptions());
        return res.status(201).send({ success: true, token });
      } else {
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
      const user = await UserDataGet(span, userSession.userId);
      return res.status(200).send({
        isAuthenticated: true,
        userId: userSession.userId,
        userName: user?.name,
        permissions: userSession.permissions,
      });
    });

    // Clears the httpOnly session cookie (JavaScript cannot).
    fastify.post("/logout", async (req, res) => {
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
      if (!(await UserDataGet(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      // The user and its permission row must be deleted atomically.
      const applyDelete = SqlDbUtilsGetDatabase().transaction(() => {
        UserDataDeleteStatement(span, req.params.userId);
        UserPermissionDataDeleteForUserStatement(span, req.params.userId);
      });
      applyDelete();
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
      const user = await UserDataGet(span, userSession.userId);
      if (!user) {
        return res.status(404).send({ error: "Not Found" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (
        !(await UserPasswordCheckPassword(span, user, req.body.passwordOld))
      ) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(span, user, req.body.password);
      await UserDataUpdate(span, user);
      res.status(201).send({});
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
      const permissions = await UserPermissionDataGetForUser(
        span,
        req.params.userId,
      );
      permissions.info = req.body.info;
      await UserPermissionDataUpdateForUser(
        span,
        req.params.userId,
        permissions,
      );
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
