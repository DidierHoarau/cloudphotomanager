import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFolder,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";

jest.mock("./AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("AnalysisRoutes permissions", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let fp1: any;
  let fp2: any;
  let fp3: any;
  let fq1: any;
  let fq2: any;
  let tokenAdmin: string;
  let tokenUserP: string;
  let tokenUserNon: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-analysis-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    const folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    // Duplicate groups: dup-in-p (fp1 + fp2, both /p), dup-cross (fp3 in /p
    // + fq1 in /q), plus a unique hash excluded from duplicate results.
    fp1 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderP,
      "alpha.jpg",
      "dup-in-p",
    );
    fp2 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderP,
      "beta.jpg",
      "dup-in-p",
    );
    fp3 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderP,
      "gamma.jpg",
      "dup-cross",
    );
    fq1 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderQ,
      "delta.jpg",
      "dup-cross",
    );
    fq2 = await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderQ,
      "eps.jpg",
      "unique-q",
    );

    const admin = await routeSpecAddUser(ctx, {
      name: "admin",
      password: "pw",
      isAdmin: true,
    });
    const userP = await routeSpecAddUser(ctx, {
      name: "user-p",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non",
      password: "pw",
      grants: [],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUserP = await routeSpecTokenFor(ctx, userP);
    tokenUserNon = await routeSpecTokenFor(ctx, userNon);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("rejects unauthenticated duplicates requests", async () => {
    const list = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
    });
    expect(list.statusCode).toBe(403);
    const one = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fp1.id}`,
    });
    expect(one.statusCode).toBe(403);
    const counts = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      payload: { fileIds: [fp1.id] },
    });
    expect(counts.statusCode).toBe(403);
  });

  it("scopes the duplicate list to permitted folders", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    expect(
      admin
        .json()
        .duplicates.map((g: any) => g.hash)
        .sort(),
    ).toEqual(["dup-cross", "dup-in-p"]);

    // The dup-cross partner in /q is invisible to user-p, so the group is
    // not a duplicate within the visible scope.
    const userP = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.statusCode).toBe(200);
    expect(userP.json().duplicates.map((g: any) => g.hash)).toEqual([
      "dup-in-p",
    ]);

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.statusCode).toBe(200);
    expect(userNon.json().duplicates).toEqual([]);
  });

  it("scopes single-file duplicate lookups to permitted folders", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fp1.id}`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().duplicate.hash).toBe("dup-in-p");
    expect(
      admin
        .json()
        .duplicate.files.map((f: any) => f.id)
        .sort(),
    ).toEqual([fp1.id, fp2.id].sort());

    const userP = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fp1.id}`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.json().duplicate.hash).toBe("dup-in-p");

    // fq1 is not in a permitted folder for user-p: no duplicate group.
    const outsideGrant = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fq1.id}`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(outsideGrant.statusCode).toBe(200);
    expect(outsideGrant.json().duplicate).toBeNull();

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fp1.id}`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.json().duplicate).toBeNull();

    const unknown = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/no-such-file`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(unknown.json().duplicate).toBeNull();
  });

  it("scopes duplicate counts and caps the request size", async () => {
    const empty = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds: [] },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().counts).toEqual({});

    const tooMany = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: {
        fileIds: Array.from({ length: 201 }, (_, index) => `id-${index}`),
      },
    });
    expect(tooMany.statusCode).toBe(400);

    const admin = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds: [fp1.id, fp3.id, fq2.id, "no-such-file"] },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().counts).toEqual({
      [fp1.id]: 2,
      [fp3.id]: 2,
    });

    // For user-p, fq1 (the /q side of dup-cross) and fq2 are out of scope
    // and fp3 has only one visible member; fp1 keeps its 2 /p members.
    const userP = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenUserP),
      payload: { fileIds: [fp1.id, fp3.id, fq1.id, fq2.id] },
    });
    expect(userP.statusCode).toBe(200);
    expect(userP.json().counts).toEqual({ [fp1.id]: 2 });

    const userNon = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenUserNon),
      payload: { fileIds: [fp1.id] },
    });
    expect(userNon.statusCode).toBe(200);
    expect(userNon.json().counts).toEqual({});
  });
});
