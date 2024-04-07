import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AccountDefinition } from "../model/AccountDefinition";
import { Scheduler } from "../sync/Scheduler";
import { Auth } from "../users/Auth";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { AccountData } from "./AccountData";
import { AccountFactory } from "./AccountFactory";
import { Logger } from "../utils-std-ts/Logger";
import { FolderData } from "../folders/FolderData";

const logger = new Logger("AccountRoutes");

export class AccountRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const accounts = await AccountData.list(span);
      accounts.forEach((account: AccountDefinition) => {
        delete account.infoPrivate;
      });
      return res.status(200).send({ accounts });
    });

    interface PostAccountValidation extends RequestGenericInterface {
      Body: {
        info: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        infoPrivate: any;
      };
    }
    fastify.post<PostAccountValidation>("/validation", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const accountDefinition = new AccountDefinition();
      accountDefinition.info = req.body.info;
      accountDefinition.infoPrivate = req.body.infoPrivate;
      const account = await AccountFactory.getAccountFromDefinition(accountDefinition);
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
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
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
      const account = await AccountFactory.getAccountFromDefinition(accountDefinition);
      if (!(await account.validate(span))) {
        return res.status(400).send({ error: "Account Validation Failed" });
      }
      await AccountData.add(span, account.getAccountDefinition());
      Scheduler.startAccountSync(span, account.getAccountDefinition()).catch((err) => {
        logger.error(err);
      });
      return res.status(201).send(account);
    });

    interface DeleteAccount extends RequestGenericInterface {
      Params: {
        accountId: string;
      };
    }
    fastify.delete<DeleteAccount>("/:accountId", async (req, res) => {
      const span = StandardTracer.getSpanFromRequest(req);
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      let account = await AccountData.get(span, req.params.accountId);
      if (!account) {
        return res.status(404).send({ error: "Account Not Found" });
      }
      await AccountData.delete(span, account.id);
      return res.status(202).send({});
    });

    fastify.get("/onedrive/info", async (req, res) => {
      const userSession = await Auth.getUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (
        !process.env.ONEDRIVE_CLIENT_ID ||
        !process.env.ONEDRIVE_CLIENT_SECRET ||
        !process.env.ONEDRIVE_CALLBACK_SIGNIN
      ) {
        return res.status(500).send({ error: "OneDrive Client Not Configured" });
      }
      return res.status(200).send({
        ONEDRIVE_CLIENT_ID: process.env.ONEDRIVE_CLIENT_ID,
        ONEDRIVE_CALLBACK_SIGNIN: process.env.ONEDRIVE_CALLBACK_SIGNIN,
      });
    });
  }
}
