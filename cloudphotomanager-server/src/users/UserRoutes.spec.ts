import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCookieFromResponse,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("UserRoutes", () => {
  let ctx: RouteSpecContext;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("reports initialization state", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/status/initialization",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ initialized: false });
  });

  it("bootstraps the first user as admin", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/",
      payload: { name: "bootstrap", password: "pw-bootstrap" },
    });
    expect(res.statusCode).toBe(201);

    const user = await ctx.userData.UserDataGetByName(ctx.span, "bootstrap");
    expect(user).toBeTruthy();
    const permission =
      await ctx.userPermissionData.UserPermissionDataGetForUser(
        ctx.span,
        user.id,
      );
    expect(permission.info.isAdmin).toBe(true);

    const init = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/status/initialization",
    });
    expect(init.json()).toEqual({ initialized: true });
  });

  it("logs in with name/password and sets a signed httpOnly cookie", async () => {
    await routeSpecAddUser(ctx, { name: "alice", password: "pw-alice" });
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();

    const setCookie = ([] as string[]).concat(
      res.headers["set-cookie"] as any,
    )[0];
    expect(setCookie).toContain("token=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });

  it("rejects an unknown user or a wrong password", async () => {
    const unknown = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "nobody", password: "pw" },
    });
    expect(unknown.statusCode).toBe(403);

    const wrongPassword = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-wrong" },
    });
    expect(wrongPassword.statusCode).toBe(403);
  });

  it("authenticates from the signed cookie without echoing a token", async () => {
    const login = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice" },
    });
    const cookie = routeSpecCookieFromResponse(login);

    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    // A script must not be able to read a usable bearer token back out of a
    // cookie-based session.
    expect(body.token).toBeUndefined();
  });

  it("returns session info and echoes the token for header sessions", async () => {
    const alice = await ctx.userData.UserDataGetByName(ctx.span, "alice");
    const token = await routeSpecTokenFor(ctx, alice);

    const unauth = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/session",
    });
    expect(unauth.statusCode).toBe(403);

    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/session",
      headers: routeSpecAuthHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isAuthenticated).toBe(true);
    expect(body.userId).toBe(alice.id);
    expect(body.userName).toBe("alice");
    expect(body.permissions).toEqual({ isAdmin: false });

    const refreshed = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      headers: routeSpecAuthHeaders(token),
    });
    expect(refreshed.statusCode).toBe(201);
    expect(refreshed.json().token).toBeTruthy();
  });

  it("clears the session cookie on logout", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/logout",
    });
    expect(res.statusCode).toBe(200);
    const setCookie = ([] as string[]).concat(
      res.headers["set-cookie"] as any,
    )[0];
    expect(setCookie).toContain("token=");
    expect(setCookie).toContain("Expires=");
  });

  it("validates access from header and cookie credentials", async () => {
    const denied = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/access/validate",
    });
    expect(denied.statusCode).toBe(403);

    const alice = await ctx.userData.UserDataGetByName(ctx.span, "alice");
    const token = await routeSpecTokenFor(ctx, alice);
    const allowed = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/access/validate",
      headers: routeSpecAuthHeaders(token),
    });
    expect(allowed.statusCode).toBe(200);

    const login = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice" },
    });
    const cookie = routeSpecCookieFromResponse(login);
    const allowedFromCookie = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/access/validate",
      headers: { cookie },
    });
    expect(allowedFromCookie.statusCode).toBe(200);
  });

  it("changes the password of the authenticated user (A3 regression)", async () => {
    const login = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice" },
    });
    const token = login.json().token;

    const wrongOld = await ctx.fastify.inject({
      method: "PUT",
      url: "/api/users/password",
      headers: routeSpecAuthHeaders(token),
      payload: { password: "pw-alice2", passwordOld: "pw-nope" },
    });
    expect(wrongOld.statusCode).toBe(403);
    expect(wrongOld.json().error).toBe("Old Password Wrong");

    const changed = await ctx.fastify.inject({
      method: "PUT",
      url: "/api/users/password",
      headers: routeSpecAuthHeaders(token),
      payload: { password: "pw-alice2", passwordOld: "pw-alice" },
    });
    expect(changed.statusCode).toBe(201);

    const oldPassword = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice" },
    });
    expect(oldPassword.statusCode).toBe(403);

    const newPassword = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "alice", password: "pw-alice2" },
    });
    expect(newPassword.statusCode).toBe(201);
  });

  it("restricts user administration to admins", async () => {
    const alice = await ctx.userData.UserDataGetByName(ctx.span, "alice");
    const aliceToken = await routeSpecTokenFor(ctx, alice);
    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw-admin",
      isAdmin: true,
    });
    const adminToken = await routeSpecTokenFor(ctx, admin);

    const listDenied = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(aliceToken),
    });
    expect(listDenied.statusCode).toBe(403);

    const listAllowed = await ctx.fastify.inject({
      method: "GET",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(listAllowed.statusCode).toBe(201);
    const names = listAllowed.json().users.map((u: any) => u.name);
    expect(names).toContain("alice");
    expect(names).toContain("admin");

    const createDenied = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(aliceToken),
      payload: { name: "denied-user", password: "pw" },
    });
    expect(createDenied.statusCode).toBe(403);

    const createAllowed = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(adminToken),
      payload: { name: "bob", password: "pw-bob" },
    });
    expect(createAllowed.statusCode).toBe(201);

    const createDuplicate = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/",
      headers: routeSpecAuthHeaders(adminToken),
      payload: { name: "bob", password: "pw-bob" },
    });
    expect(createDuplicate.statusCode).toBe(400);

    const deleteDenied = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${alice.id}`,
      headers: routeSpecAuthHeaders(aliceToken),
    });
    expect(deleteDenied.statusCode).toBe(403);

    const deleteMissing = await ctx.fastify.inject({
      method: "DELETE",
      url: "/api/users/no-such-user",
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(deleteMissing.statusCode).toBe(404);

    const bob = await ctx.userData.UserDataGetByName(ctx.span, "bob");
    const deleteAllowed = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/users/${bob.id}`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(deleteAllowed.statusCode).toBe(202);
    expect(await ctx.userData.UserDataGet(ctx.span, bob.id)).toBeNull();
    const bobPermission =
      await ctx.userPermissionData.UserPermissionDataGetForUser(
        ctx.span,
        bob.id,
      );
    expect(bobPermission.info.isAdmin).toBe(false);
    expect(bobPermission.info.folders).toEqual([]);
  });

  it("restricts permission management to admins", async () => {
    const alice = await ctx.userData.UserDataGetByName(ctx.span, "alice");
    const aliceToken = await routeSpecTokenFor(ctx, alice);
    const admin = await ctx.userData.UserDataGetByName(ctx.span, "admin");
    const adminToken = await routeSpecTokenFor(ctx, admin);

    const denied = await ctx.fastify.inject({
      method: "GET",
      url: `/api/users/${alice.id}/permissions`,
      headers: routeSpecAuthHeaders(aliceToken),
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await ctx.fastify.inject({
      method: "GET",
      url: `/api/users/${alice.id}/permissions`,
      headers: routeSpecAuthHeaders(adminToken),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().info.isAdmin).toBe(false);
  });
});
