import { FastifyInstance } from "fastify";
import { SyncQueueGetCounts } from "./SyncQueue";
import { AuthGetUserSession } from "../users/Auth";

export class SyncRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      return res.status(200).send({ sync: SyncQueueGetCounts() });
    });
  }
}
