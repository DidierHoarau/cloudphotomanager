import * as fs from "fs-extra";
import * as path from "path";
import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { User } from "../model/User";

describe("AccountRoutes", () => {
  let ctx: RouteSpecContext;
  let admin: User;
  let adminToken: string;
  let regular: User;
  let regularToken: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    await fs.ensureDir(ctx.rootPath);
    admin = await routeSpecAddUser(ctx, {
      name: "account-admin",
      password: "pw-account-admin",
      isAdmin: true,
    });
    adminToken = await routeSpecTokenFor(ctx, admin);
    regular = await routeSpecAddUser(ctx, {
      name: "account-regular",
      password: "pw-account-regular",
    });
    regularToken = await routeSpecTokenFor(ctx, regular);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("restricts the account validation probe to admins", async () => {
    const payload = {
      info: { type: "localDrive" },
      infoPrivate: {},
      rootpath: ctx.rootPath,
    };
    const anonymous = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts/validation",
      payload,
    });
    expect(anonymous.statusCode).toBe(403);

    const denied = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts/validation",
      headers: routeSpecAuthHeaders(regularToken),
      payload,
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts/validation",
      headers: routeSpecAuthHeaders(adminToken),
      payload,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("returns 400 for an invalid or unknown account configuration", async () => {
    const unknownType = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts/validation",
      headers: routeSpecAuthHeaders(adminToken),
      payload: { info: { type: "not-a-provider" }, infoPrivate: {} },
    });
    expect(unknownType.statusCode).toBe(400);

    const missingRoot = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts/validation",
      headers: routeSpecAuthHeaders(adminToken),
      payload: {
        info: { type: "localDrive" },
        infoPrivate: {},
        rootpath: path.join(ctx.baseDir, "does-not-exist"),
      },
    });
    expect(missingRoot.statusCode).toBe(400);
  });

  it("returns 404 (not 500) for a missing account on read, update and delete", async () => {
    const read = await ctx.fastify.inject({
      method: "GET",
      url: "/api/accounts/no-such-account",
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(read.statusCode).toBe(404);

    const update = await ctx.fastify.inject({
      method: "PUT",
      url: "/api/accounts/no-such-account",
      headers: routeSpecAuthHeaders(adminToken),
      payload: {
        name: "renamed",
        rootpath: ctx.rootPath,
        info: { type: "localDrive" },
        infoPrivate: {},
      },
    });
    expect(update.statusCode).toBe(404);

    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: "/api/accounts/no-such-account",
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(del.statusCode).toBe(404);
  });
});
