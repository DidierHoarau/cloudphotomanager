import { FastifyInstance, RequestGenericInterface } from "fastify";
import { UserPassword } from "../data/UserPassword";
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
      if ((await UserData.list(StandardTracer.getSpanFromRequest(req))).length === 0) {
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
      let user: User;
      // From token
      const userSession = await Auth.getUserSession(req);
      if (userSession.isAuthenticated) {
        user = await UserData.get(StandardTracer.getSpanFromRequest(req), userSession.userId);
        return res
          .status(201)
          .send({ success: true, token: await Auth.generateJWT(StandardTracer.getSpanFromRequest(req), user) });
      }

      // From User/Pass
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      user = await UserData.getByName(StandardTracer.getSpanFromRequest(req), req.body.name);
      if (!user) {
        return res.status(403).send({ error: "Authentication Failed" });
      } else if (await UserPassword.checkPassword(StandardTracer.getSpanFromRequest(req), user, req.body.password)) {
        return res
          .status(201)
          .send({ success: true, token: await Auth.generateJWT(StandardTracer.getSpanFromRequest(req), user) });
      } else {
        return res.status(403).send({ error: "Authentication Failed" });
      }
    });

    interface PostUser extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      let isInitialized = true;
      if ((await UserData.list(StandardTracer.getSpanFromRequest(req))).length === 0) {
        isInitialized = false;
      }
      const userSession = await Auth.getUserSession(req);
      if (isInitialized && !userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const newUser = new User();
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (await UserData.getByName(StandardTracer.getSpanFromRequest(req), req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }
      let isAdmin = false;
      if (!isInitialized) {
        isAdmin = true;
      }
      newUser.name = req.body.name;
      await UserPassword.setPassword(StandardTracer.getSpanFromRequest(req), newUser, req.body.password);
      const userPermission = new UserPermission();
      userPermission.userId = newUser.id;
      userPermission.isAdmin = isAdmin;
      await UserData.add(StandardTracer.getSpanFromRequest(req), newUser);
      await UserPermissionData.updateForUser(StandardTracer.getSpanFromRequest(req), newUser.id, userPermission);
      res.status(201).send({});
    });

    interface PutNewPassword extends RequestGenericInterface {
      Body: {
        password: string;
        passwordOld: string;
      };
    }
    fastify.put<PutNewPassword>("/password", async (req, res) => {
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const user = await UserData.get(StandardTracer.getSpanFromRequest(req), userSession.userId);
      if (!req.body.password || !req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (!(await UserPassword.checkPassword(StandardTracer.getSpanFromRequest(req), user, req.body.passwordOld))) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPassword.setPassword(StandardTracer.getSpanFromRequest(req), user, req.body.password);
      await UserData.update(StandardTracer.getSpanFromRequest(req), user);
      res.status(201).send({});
    });
  }
}
