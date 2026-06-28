import { FastifyInstance } from "fastify";
import {
  SearchDataAggregateByGeoGrid,
  SearchDataListAccountDuplicates,
  SearchDataListFiles,
} from "./SearchData";
import { AuthGetUserSession } from "../users/Auth";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { GeoBox, isValidGeoBox } from "./SearchGeoSql";

export class SearchRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
      };
    }>("/duplicates", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const duplicates = await SearchDataListAccountDuplicates(
        OTelRequestSpan(req),
        req.params.accountId,
      );
      return res.send({ duplicates });
    });

    fastify.post<{
      Params: {
        accountId: string;
      };
      Body: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filters: any;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const files = await SearchDataListFiles(
        OTelRequestSpan(req),
        req.params.accountId,
        req.body.filters,
      );
      return res.status(200).send({ files });
    });

    fastify.post<{
      Params: {
        accountId: string;
      };
      Body: {
        bbox: GeoBox;
        gridRows?: number;
        gridCols?: number;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filters?: any;
      };
    }>("/geoGrid", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!isValidGeoBox(req.body?.bbox)) {
        return res.status(400).send({ error: "Invalid bbox" });
      }
      const result = await SearchDataAggregateByGeoGrid(
        OTelRequestSpan(req),
        req.params.accountId,
        {
          bbox: req.body.bbox,
          gridRows: req.body.gridRows,
          gridCols: req.body.gridCols,
          filters: req.body.filters,
        },
      );
      return res.status(200).send(result);
    });
  }
}
