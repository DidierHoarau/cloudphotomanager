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

  it("never returns provider secrets from create, update or read", async () => {
    const secret = "sentinel-secret";
    const payload = {
      name: "leak-check",
      rootpath: ctx.rootPath,
      info: { type: "localDrive" },
      infoPrivate: { accessKey: secret },
    };

    const created = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts",
      headers: routeSpecAuthHeaders(adminToken),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.id).toBeTruthy();
    expect(createdBody.name).toBe("leak-check");
    expect(createdBody.info).toEqual({ type: "localDrive" });
    expect(createdBody).not.toHaveProperty("infoPrivate");
    expect(createdBody).not.toHaveProperty("accountDefinition");
    expect(JSON.stringify(createdBody)).not.toContain(secret);

    const updatePayload = { ...payload, name: "leak-check-renamed" };
    const updated = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${createdBody.id}`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: updatePayload,
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json();
    expect(updatedBody.name).toBe("leak-check-renamed");
    expect(updatedBody).not.toHaveProperty("infoPrivate");
    expect(JSON.stringify(updatedBody)).not.toContain(secret);

    const denied = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/accounts/${createdBody.id}`,
      headers: routeSpecAuthHeaders(regularToken),
      payload: updatePayload,
    });
    expect(denied.statusCode).toBe(403);

    const read = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${createdBody.id}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json();
    expect(readBody).not.toHaveProperty("infoPrivate");
    expect(JSON.stringify(readBody)).not.toContain(secret);
  });

  it("returns a minimal DTO to non-admins and the full definition to admins", async () => {
    const secret = "sentinel-read-secret";
    const created = await ctx.fastify.inject({
      method: "POST",
      url: "/api/accounts",
      headers: routeSpecAuthHeaders(adminToken),
      payload: {
        name: "dto-account",
        rootpath: ctx.rootPath,
        info: { type: "localDrive" },
        infoPrivate: { accessKey: secret },
      },
    });
    expect(created.statusCode).toBe(201);
    const accountId = created.json().id;

    const adminList = await ctx.fastify.inject({
      method: "GET",
      url: "/api/accounts",
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(adminList.statusCode).toBe(200);
    const adminRow = adminList
      .json()
      .accounts.find((account: any) => account.id === accountId);
    expect(adminRow).toBeTruthy();
    expect(adminRow.type).toBe("localDrive");
    expect(adminRow.info.type).toBe("localDrive");
    expect(adminRow.rootpath).toBe(ctx.rootPath);
    expect(adminRow.capabilities).toBeDefined();
    expect(adminRow).not.toHaveProperty("infoPrivate");
    expect(JSON.stringify(adminList.json())).not.toContain(secret);

    const adminDetail = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountId}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().info.type).toBe("localDrive");
    expect(adminDetail.json()).not.toHaveProperty("infoPrivate");

    const regularList = await ctx.fastify.inject({
      method: "GET",
      url: "/api/accounts",
      headers: routeSpecAuthHeaders(regularToken),
    });
    expect(regularList.statusCode).toBe(200);
    const regularRow = regularList
      .json()
      .accounts.find((account: any) => account.id === accountId);
    expect(regularRow).toBeTruthy();
    expect(Object.keys(regularRow).sort()).toEqual([
      "capabilities",
      "id",
      "name",
      "type",
    ]);
    expect(regularRow.type).toBe("localDrive");
    expect(regularRow).not.toHaveProperty("rootpath");
    expect(regularRow).not.toHaveProperty("info");
    expect(regularRow).not.toHaveProperty("infoPrivate");
    expect(JSON.stringify(regularList.json())).not.toContain(ctx.rootPath);
    expect(JSON.stringify(regularList.json())).not.toContain(secret);

    const regularDetail = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountId}`,
      headers: routeSpecAuthHeaders(regularToken),
    });
    expect(regularDetail.statusCode).toBe(200);
    expect(Object.keys(regularDetail.json()).sort()).toEqual([
      "capabilities",
      "id",
      "name",
      "type",
    ]);
    expect(JSON.stringify(regularDetail.json())).not.toContain(ctx.rootPath);
    expect(JSON.stringify(regularDetail.json())).not.toContain(secret);
  });
});
