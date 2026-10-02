import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCreateAccount,
  routeSpecCreateFile,
  routeSpecCreateFolder,
  routeSpecSetFileMeta,
  routeSpecSetup,
  routeSpecTokenFor,
  RouteSpecContext,
} from "../specTestUtils/RouteSpecHarness";

jest.mock("./AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("SearchRoutes permissions", () => {
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
    accountA = await routeSpecCreateAccount(ctx, "acct-search-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    const folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    // Duplicate groups: dup-in-p (fp1 + fp2, both /p), dup-cross (fp3 in /p
    // + fq1 in /q), plus a unique hash.
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
    await routeSpecSetFileMeta(ctx, fp1, {
      dateMedia: new Date("2024-01-10T00:00:00Z"),
      keywords: "beach sunset",
      gps: { latitude: 48.85, longitude: 2.35 },
    });
    await routeSpecSetFileMeta(ctx, fp2, {
      dateMedia: new Date("2024-06-10T00:00:00Z"),
    });
    await routeSpecSetFileMeta(ctx, fp3, {
      dateMedia: new Date("2024-02-10T00:00:00Z"),
    });
    await routeSpecSetFileMeta(ctx, fq1, {
      dateMedia: new Date("2024-03-10T00:00:00Z"),
      keywords: "mountain beach",
      gps: { latitude: 48.86, longitude: 2.36 },
    });
    await routeSpecSetFileMeta(ctx, fq2, {
      dateMedia: new Date("2024-09-10T00:00:00Z"),
    });
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

  function search(token: string, filters: any) {
    return ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search`,
      headers: routeSpecAuthHeaders(token),
      payload: { filters },
    });
  }

  function fileIds(res: any): string[] {
    return res
      .json()
      .files.map((f: any) => f.id)
      .sort();
  }

  it("rejects unauthenticated search, duplicates and geoGrid requests", async () => {
    const searchRes = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search`,
      payload: { filters: {} },
    });
    expect(searchRes.statusCode).toBe(403);
    const duplicates = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/files/search/duplicates`,
    });
    expect(duplicates.statusCode).toBe(403);
    const geoGrid = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search/geoGrid`,
      payload: { bbox: { minLat: 48, maxLat: 49, minLon: 2, maxLon: 3 } },
    });
    expect(geoGrid.statusCode).toBe(403);
  });

  it("filters search results by folder permission", async () => {
    const admin = await search(tokenAdmin, {});
    expect(admin.statusCode).toBe(200);
    expect(fileIds(admin)).toEqual(
      [fp1.id, fp2.id, fp3.id, fq1.id, fq2.id].sort(),
    );

    const userP = await search(tokenUserP, {});
    expect(fileIds(userP)).toEqual([fp1.id, fp2.id, fp3.id].sort());

    const userNon = await search(tokenUserNon, {});
    expect(fileIds(userNon)).toEqual([]);
  });

  it("applies keyword filters inside the permitted folders only", async () => {
    const admin = await search(tokenAdmin, { keywords: "beach" });
    expect(fileIds(admin)).toEqual([fp1.id, fq1.id].sort());

    const userP = await search(tokenUserP, { keywords: "beach" });
    expect(fileIds(userP)).toEqual([fp1.id]);

    const userNon = await search(tokenUserNon, { keywords: "beach" });
    expect(fileIds(userNon)).toEqual([]);
  });

  it("applies date and geo filters inside the permitted folders only", async () => {
    const adminDates = await search(tokenAdmin, {
      dateFrom: "2024-05-01T00:00:00Z",
    });
    expect(fileIds(adminDates)).toEqual([fp2.id, fq2.id].sort());

    const userPDates = await search(tokenUserP, {
      dateFrom: "2024-05-01T00:00:00Z",
    });
    expect(fileIds(userPDates)).toEqual([fp2.id]);

    const geoBox = { minLat: 48.8, maxLat: 48.9, minLon: 2.3, maxLon: 2.4 };
    const adminGeo = await search(tokenAdmin, { geoBox });
    expect(fileIds(adminGeo)).toEqual([fp1.id, fq1.id].sort());

    const userPGeo = await search(tokenUserP, { geoBox });
    expect(fileIds(userPGeo)).toEqual([fp1.id]);
  });

  it("scopes duplicate groups to permitted folders", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/files/search/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    const adminGroups = admin.json().duplicates;
    expect(adminGroups.map((g: any) => g.hash).sort()).toEqual([
      "dup-cross",
      "dup-in-p",
    ]);
    const inP = adminGroups.find((g: any) => g.hash === "dup-in-p");
    expect(inP.files.map((f: any) => f.id).sort()).toEqual(
      [fp1.id, fp2.id].sort(),
    );

    // fp3 + fq1 share a hash but only fp3 is inside the grant: with one
    // member visible the group is no longer a duplicate for this user.
    const userP = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/files/search/duplicates`,
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.statusCode).toBe(200);
    expect(userP.json().duplicates.map((g: any) => g.hash)).toEqual([
      "dup-in-p",
    ]);

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/files/search/duplicates`,
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.statusCode).toBe(200);
    expect(userNon.json().duplicates).toEqual([]);
  });

  it("validates the geoGrid bbox and scopes the aggregation", async () => {
    const invalid = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search/geoGrid`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { bbox: { minLat: "north" } },
    });
    expect(invalid.statusCode).toBe(400);

    const bbox = { minLat: 48, maxLat: 49, minLon: 2, maxLon: 3 };
    const sum = (res: any) =>
      res
        .json()
        .cells.reduce((total: number, cell: any) => total + cell.count, 0);
    const admin = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search/geoGrid`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { bbox, gridRows: 2, gridCols: 2 },
    });
    expect(admin.statusCode).toBe(200);
    expect(sum(admin)).toBe(2);

    const userP = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search/geoGrid`,
      headers: routeSpecAuthHeaders(tokenUserP),
      payload: { bbox, gridRows: 2, gridCols: 2 },
    });
    expect(sum(userP)).toBe(1);

    const userNon = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/files/search/geoGrid`,
      headers: routeSpecAuthHeaders(tokenUserNon),
      payload: { bbox, gridRows: 2, gridCols: 2 },
    });
    expect(sum(userNon)).toBe(0);
  });
});
