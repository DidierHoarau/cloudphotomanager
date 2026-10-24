import {
  routeSpecAddUser,
  routeSpecAuthHeaders,
  routeSpecCreateAccount,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";
import { User } from "../model/User";

describe("User security", () => {
  let ctx: RouteSpecContext;
  let admin: User;
  let adminToken: string;
  let regular: User;
  let folder: { id: string };

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    admin = await routeSpecAddUser(ctx, {
      name: "security-admin",
      password: "pw-security-admin",
      isAdmin: true,
    });
    adminToken = await routeSpecTokenFor(ctx, admin);
    regular = await routeSpecAddUser(ctx, {
      name: "security-regular",
      password: "pw-security-regular",
    });
    const account = await routeSpecCreateAccount(ctx, "security-account");
    folder = await routeSpecCreateFolder(ctx, account.id, "/photos");
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  function session(token: string) {
    return ctx.fastify.inject({
      method: "GET",
      url: "/api/users/session",
      headers: routeSpecAuthHeaders(token),
    });
  }

  it("protects the last admin from demotion", async () => {
    const demote = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/users/${admin.id}/permissions`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { info: { isAdmin: false, folders: [] } },
    });
    expect(demote.statusCode).toBe(403);
    expect(demote.json().error).toBe("Cannot demote the last admin");

    const permission =
      await ctx.userPermissionData.UserPermissionDataGetForUser(
        ctx.span,
        admin.id,
      );
    expect(permission.info.isAdmin).toBe(true);
  });

  it("validates the permission JSON before storing it", async () => {
    const invalidPayloads = [
      {},
      { info: "not-an-object" },
      { info: { isAdmin: "yes", folders: [] } },
      { info: { isAdmin: false, folders: "nope" } },
      { info: { isAdmin: false, folders: [{ folderId: "missing", scope: "ro" }] } },
      {
        info: {
          isAdmin: false,
          folders: [{ folderId: folder.id, scope: "admin" }],
        },
      },
      { info: { isAdmin: false, folders: [], ignoredField: "dropped" } },
    ];
    for (const payload of invalidPayloads) {
      const res = await ctx.fastify.inject({
        method: "PUT",
        url: `/api/users/${regular.id}/permissions`,
        headers: routeSpecAuthHeaders(adminToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }

    const valid = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/users/${regular.id}/permissions`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: {
        info: {
          isAdmin: false,
          folders: [{ folderId: folder.id, scope: "ro_recursive" }],
        },
      },
    });
    expect(valid.statusCode).toBe(201);
    const stored = await ctx.userPermissionData.UserPermissionDataGetForUser(
      ctx.span,
      regular.id,
    );
    expect(stored.info).toEqual({
      isAdmin: false,
      folders: [{ folderId: folder.id, scope: "ro_recursive" }],
    });
  });

  it("enforces the password policy on user creation", async () => {
    const short = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(adminToken),
      payload: { name: "short-password", password: "short" },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toContain("at least 8 characters");
  });

  it("revokes an admin session as soon as the admin is demoted", async () => {
    const secondAdmin = await routeSpecAddUser(ctx, {
      name: "security-admin-2",
      password: "pw-security-admin-2",
      isAdmin: true,
    });
    const secondToken = await routeSpecTokenFor(ctx, secondAdmin);
    const before = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(secondToken),
    });
    expect(before.statusCode).toBe(201);

    const demote = await ctx.fastify.inject({
      method: "PUT",
      url: `/api/users/${secondAdmin.id}/permissions`,
      headers: routeSpecAuthHeaders(adminToken),
      payload: { info: { isAdmin: false, folders: [] } },
    });
    expect(demote.statusCode).toBe(201);

    // The old session token is revoked and the demoted user can no longer
    // reach the admin-only endpoint.
    expect((await session(secondToken)).statusCode).toBe(403);
    const after = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(secondToken),
    });
    expect(after.statusCode).toBe(403);
  });

  it("locks out a deleted user on its next request", async () => {
    const victim = await routeSpecAddUser(ctx, {
      name: "security-victim",
      password: "pw-security-victim",
    });
    const victimToken = await routeSpecTokenFor(ctx, victim);
    expect((await session(victimToken)).statusCode).toBe(200);

    const deleted = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${victim.id}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(deleted.statusCode).toBe(202);

    expect((await session(victimToken)).statusCode).toBe(403);
  });

  it("invalidates the token server-side on logout", async () => {
    // The permission changes above revoked the earlier token: start from a
    // freshly issued session, then check that logout kills it server-side.
    const current = await ctx.userData.UserDataGet(ctx.span, regular.id);
    const token = await routeSpecTokenFor(ctx, current);
    expect((await session(token)).statusCode).toBe(200);

    const logout = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/logout",
      headers: routeSpecAuthHeaders(token),
    });
    expect(logout.statusCode).toBe(200);

    expect((await session(token)).statusCode).toBe(403);
  });
});
