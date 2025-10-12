import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { User } from "../model/User";
import { UserPermission } from "../model/UserPermission";
import {
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthIsAdmin,
  AuthIsTokenValid,
} from "./Auth";
import {
  UserDataAdd,
  UserDataDelete,
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
  UserPermissionDataDeleteForUser,
  UserPermissionDataGetForUser,
  UserPermissionDataUpdateForUser,
} from "./UserPermissionData";

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

    interface PostSession extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostSession>("/session", async (req, res) => {
      const span = OTelRequestSpan(req);
      let user: User;
      // From token
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        user = await UserDataGet(span, userSession.userId);
        const token = await AuthGenerateJWT(span, user);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res as any).setCookie("token", token, {
          path: "/",
          signed: true,
        });
        return res.status(201).send({ success: true, token });
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res as any).setCookie("token", token, {
          path: "/",
          signed: true,
        });
        return res.status(201).send({ success: true, token });
      } else {
        return res.status(403).send({ error: "Authentication Failed" });
      }
    });

    fastify.get("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      res.status(201).send({ users: await UserDataList(span) });
    });

    interface PostUser extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostUser>("/", async (req, res) => {
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
      await UserDataAdd(span, newUser);
      await UserPermissionDataUpdateForUser(span, newUser.id, userPermission);
      res.status(201).send({});
    });

    interface DeletetUser extends RequestGenericInterface {
      Params: {
        userId: string;
      };
    }
    fastify.delete<DeletetUser>("/:userId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserDataGetByName(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      await UserDataDelete(span, req.params.userId);
      await UserPermissionDataDeleteForUser(span, req.params.userId);
      res.status(202).send({});
    });

    interface PutNewPassword extends RequestGenericInterface {
      Body: {
        password: string;
        passwordOld: string;
      };
    }
    fastify.put<PutNewPassword>("/password", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const user = await UserDataGetByName(span, userSession.userId);
      if (!req.body.password || !req.body.password) {
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

    interface GetUserIdPermissions extends RequestGenericInterface {
      Params: {
        userId: string;
      };
    }
    fastify.get<GetUserIdPermissions>(
      "/:userId/permissions",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!AuthIsAdmin(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        if (!(await UserDataGetByName(span, req.params.userId))) {
          return res.status(404).send({ error: "Not Found" });
        }
        res
          .status(200)
          .send(await UserPermissionDataGetForUser(span, req.params.userId));
      }
    );

    interface PutUserIdPermissions extends RequestGenericInterface {
      Params: {
        userId: string;
      };
      Body: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        info: any;
      };
    }
    fastify.put<PutUserIdPermissions>(
      "/:userId/permissions",
      async (req, res) => {
        const span = OTelRequestSpan(req);
        const userSession = await AuthGetUserSession(req);
        if (!AuthIsAdmin(userSession)) {
          return res.status(403).send({ error: "Access Denied" });
        }
        if (!(await UserDataGetByName(span, req.params.userId))) {
          return res.status(404).send({ error: "Not Found" });
        }
        const permissions = await UserPermissionDataGetForUser(
          span,
          req.params.userId
        );
        permissions.info = req.body.info;
        await UserPermissionDataUpdateForUser(
          span,
          req.params.userId,
          permissions
        );
        res.status(201).send({});
      }
    );

    fastify.get("/access/validate", async (req, res) => {
      let tokenCokkie = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tokenCokkie = (fastify as any).unsignCookie((req as any).cookies.token);
      } catch (err) {
        tokenCokkie = null;
      }
      if (
        !tokenCokkie ||
        !tokenCokkie.valid ||
        !AuthIsTokenValid(tokenCokkie.value)
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      res.status(200).send({});
    });
  }
}
