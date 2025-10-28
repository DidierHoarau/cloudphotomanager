import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountDefinition } from "../model/AccountDefinition";
import { OTelLogger } from "../OTelContext";
import { SchedulerStartAccountSync } from "../sync/Scheduler";
import { AuthGetUserSession, AuthIsAdmin } from "../users/Auth";
import {
  AccountDataAdd,
  AccountDataDelete,
  AccountDataGet,
  AccountDataList,
  AccountDataUpdate,
} from "./AccountData";
import { AccountFactoryGetAccountFromDefinition } from "./AccountFactory";

const logger = OTelLogger().createModuleLogger("AccountRoutes");

export class AccountRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const accounts = await AccountDataList(span);
      accounts.forEach((account: AccountDefinition) => {
        delete account.infoPrivate;
      });
      return res.status(200).send({ accounts });
    });

    interface GetAccount extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.get<GetAccount>("/:accountId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const account = await AccountDataGet(span, req.params.accountId);
      delete account.infoPrivate;
      return res.status(200).send(account);
    });

    interface PostAccountValidation extends RequestGenericInterface {
      Body: {
        info: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        infoPrivate: any;
      };
    }
    fastify.post<PostAccountValidation>("/validation", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const accountDefinition = new AccountDefinition();
      accountDefinition.info = req.body.info;
      accountDefinition.infoPrivate = req.body.infoPrivate;
      const account =
        await AccountFactoryGetAccountFromDefinition(accountDefinition);
      if (await account.validate(span)) {
        return res.status(200).send({});
      }
      return res.status(400).send({ error: "Account Validation Failed" });
    });

    interface PostAccount extends RequestGenericInterface {
      Body: {
        name: string;
        rootpath: string;
        info: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        infoPrivate: any;
      };
    }
    fastify.post<PostAccount>("/", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing Paramter: Name" });
      }
      const accountDefinition = new AccountDefinition();
      accountDefinition.name = req.body.name;
      accountDefinition.rootpath = req.body.rootpath;
      accountDefinition.info = req.body.info;
      accountDefinition.infoPrivate = req.body.infoPrivate;
      const account =
        await AccountFactoryGetAccountFromDefinition(accountDefinition);
      if (!(await account.validate(span))) {
        return res.status(400).send({ error: "Account Validation Failed" });
      }
      await AccountDataAdd(span, account.getAccountDefinition());
      SchedulerStartAccountSync(span, account.getAccountDefinition()).catch(
        (err) => {
          logger.error("Error Synchronizing Account", err, span);
        }
      );
      return res.status(201).send(account);
    });

    interface PutAccount extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
      Body: {
        name: string;
        rootpath: string;
        info: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        infoPrivate: any;
      };
    }
    fastify.put<PutAccount>("/:accountId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing Paramter: Name" });
      }

      const accountDefinition = await AccountDataGet(
        span,
        req.params.accountId
      );
      accountDefinition.name = req.body.name;
      accountDefinition.rootpath = req.body.rootpath;
      accountDefinition.info = req.body.info;
      accountDefinition.infoPrivate = req.body.infoPrivate;
      const account =
        await AccountFactoryGetAccountFromDefinition(accountDefinition);
      if (!(await account.validate(span))) {
        return res.status(400).send({ error: "Account Validation Failed" });
      }
      await AccountDataUpdate(span, accountDefinition);
      SchedulerStartAccountSync(span, accountDefinition).catch((err) => {
        logger.error("Error Synchronizing Account", err, span);
      });
      return res.status(201).send(accountDefinition);
    });

    interface DeleteAccount extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.delete<DeleteAccount>("/:accountId", async (req, res) => {
      const span = OTelRequestSpan(req);
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const account = await AccountDataGet(span, req.params.accountId);
      if (!account) {
        return res.status(404).send({ error: "Account Not Found" });
      }
      await AccountDataDelete(span, account.id);
      return res.status(202).send({});
    });

    fastify.get("/onedrive/info", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!AuthIsAdmin(userSession)) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (
        !process.env.ONEDRIVE_CLIENT_ID ||
        !process.env.ONEDRIVE_CLIENT_SECRET ||
        !process.env.ONEDRIVE_CALLBACK_SIGNIN
      ) {
        return res
          .status(500)
          .send({ error: "OneDrive Client Not Configured" });
      }
      return res.status(200).send({
        ONEDRIVE_CLIENT_ID: process.env.ONEDRIVE_CLIENT_ID,
        ONEDRIVE_CALLBACK_SIGNIN: process.env.ONEDRIVE_CALLBACK_SIGNIN,
      });
    });
  }
}
