import { FastifyInstance, RequestGenericInterface } from "fastify";
import { UserPassword } from "./UserPassword";
import { Auth } from "./Auth";
import { User } from "../model/User";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { UserData } from "./UserData";
import { UserPermission } from "../model/UserPermission";
import { UserPermissionData } from "./UserPermissionData";

export class UserRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status/initialization", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      if ((await UserData.list(span)).length === 0) {
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
      const span = StandardTracer.getSpanFromRequest(req);
      let user: User;
      // From token
      const userSession = await Auth.getUserSession(req);
      if (userSession.isAuthenticated) {
        user = await UserData.get(span, userSession.userId);
        return res.status(201).send({ success: true, token: await Auth.generateJWT(span, user) });
      }

      // From User/Pass
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      user = await UserData.getByName(span, req.body.name);
      if (!user) {
        return res.status(403).send({ error: "Authentication Failed" });
      } else if (await UserPassword.checkPassword(span, user, req.body.password)) {
        return res.status(201).send({ success: true, token: await Auth.generateJWT(span, user) });
      } else {
        return res.status(403).send({ error: "Authentication Failed" });
      }
    });

    fastify.get("/", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated && userSession.permissions.isAdmin) {
        return res.status(403).send({ error: "Access Denied" });
      }
      res.status(201).send({ users: await UserData.list(span) });
    });

    interface PostUser extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      let isInitialized = true;
      if ((await UserData.list(span)).length === 0) {
        isInitialized = false;
      }
      const userSession = await Auth.getUserSession(req);
      if (isInitialized && !userSession.isAuthenticated && userSession.permissions.isAdmin) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const newUser = new User();
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (await UserData.getByName(span, req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }
      let isAdmin = false;
      if (!isInitialized) {
        isAdmin = true;
      }
      newUser.name = req.body.name;
      await UserPassword.setPassword(span, newUser, req.body.password);
      const userPermission = new UserPermission();
      userPermission.userId = newUser.id;
      userPermission.info.isAdmin = isAdmin;
      await UserData.add(span, newUser);
      await UserPermissionData.updateForUser(span, newUser.id, userPermission);
      res.status(201).send({});
    });

    interface DeletetUser extends RequestGenericInterface {
      Params: {
        userId: string;
      };
    }
    fastify.delete<DeletetUser>("/:userId", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated && userSession.permissions.isAdmin) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserData.get(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      await UserData.delete(span, req.params.userId);
      await UserPermissionData.deleteForUser(span, req.params.userId);
      res.status(202).send({});
    });

    interface PutNewPassword extends RequestGenericInterface {
      Body: {
        password: string;
        passwordOld: string;
      };
    }
    fastify.put<PutNewPassword>("/password", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const user = await UserData.get(span, userSession.userId);
      if (!req.body.password || !req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (!(await UserPassword.checkPassword(span, user, req.body.passwordOld))) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPassword.setPassword(span, user, req.body.password);
      await UserData.update(span, user);
      res.status(201).send({});
    });

    interface GetUserIdPermissions extends RequestGenericInterface {
      Params: {
        userId: string;
      };
    }
    fastify.get<GetUserIdPermissions>("/:userId/permissions", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated && userSession.permissions.isAdmin) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserData.get(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      res.status(200).send(await UserPermissionData.getForUser(span, req.params.userId));
    });

    interface PutUserIdPermissions extends RequestGenericInterface {
      Params: {
        userId: string;
      };
      Body: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        info: any;
      };
    }
    fastify.put<PutUserIdPermissions>("/:userId/permissions", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated && userSession.permissions.isAdmin) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!(await UserData.get(span, req.params.userId))) {
        return res.status(404).send({ error: "Not Found" });
      }
      const permissions = await UserPermissionData.getForUser(span, req.params.userId);
      permissions.info = req.body.info;
      await UserPermissionData.updateForUser(span, req.params.userId, permissions);
      res.status(201).send({});
    });
  }
}
