import { FastifyInstance } from "fastify";
import { OTelRequestSpan } from "@devopsplaybook.io/otel-utils-fastify";
import { AuthGetUserSession } from "../users/Auth";
import { MediaUrlsAttachForUser } from "../media/MediaUrls";
import {
  UserPermissionContextFolderIdsGet,
  UserPermissionContextGet,
} from "../users/UserPermissionCheck";
import { MemoriesDataList, MemoriesDate } from "./MemoriesData";

const MEMORIES_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseMemoriesDate(value: any): MemoriesDate | null {
  if (value === undefined) {
    const now = new Date();
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
    };
  }
  if (typeof value !== "string" || !MEMORIES_DATE_PATTERN.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Round-trip so impossible calendar days (2024-02-30, 2024-13-01) are
  // rejected instead of silently rolling over into the next month.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatMemoriesDate(date: MemoriesDate): string {
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}

export class MemoriesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Params: {
        accountId: string;
      };
      Querystring: {
        date?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const date = parseMemoriesDate(req.query?.date);
      if (!date) {
        return res.status(400).send({
          error: "Invalid parameter: date (expected YYYY-MM-DD)",
        });
      }
      const span = OTelRequestSpan(req);
      const permissionContext = await UserPermissionContextGet(
        span,
        userSession.userId,
      );
      const permittedFolderIds = await UserPermissionContextFolderIdsGet(
        span,
        permissionContext,
        req.params.accountId,
      );
      const sections = await MemoriesDataList(
        span,
        req.params.accountId,
        date,
        permittedFolderIds,
      );
      for (const section of sections) {
        MediaUrlsAttachForUser(section.files, userSession);
      }
      return res.status(200).send({
        date: formatMemoriesDate(date),
        sections,
      });
    });
  }
}
