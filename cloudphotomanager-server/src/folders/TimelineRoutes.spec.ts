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

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("TimelineRoutes", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let folderQ: any;
  let p1: any;
  let p2: any;
  let q1: any;
  let q2: any;
  let tokenAdmin: string;
  let tokenUserP: string;
  let tokenUserNon: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-timeline-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    p1 = await routeSpecCreateFile(ctx, accountA.id, folderP, "p1.jpg");
    p2 = await routeSpecCreateFile(ctx, accountA.id, folderP, "p2.jpg");
    q1 = await routeSpecCreateFile(ctx, accountA.id, folderQ, "q1.jpg");
    q2 = await routeSpecCreateFile(ctx, accountA.id, folderQ, "q2.jpg");
    await routeSpecSetFileMeta(ctx, p1, {
      dateMedia: new Date("2024-03-15T10:00:00.000Z"),
    });
    await routeSpecSetFileMeta(ctx, p2, {
      dateMedia: new Date("2024-03-20T10:00:00.000Z"),
    });
    await routeSpecSetFileMeta(ctx, q1, {
      dateMedia: new Date("2024-03-25T10:00:00.000Z"),
    });
    await routeSpecSetFileMeta(ctx, q2, {
      dateMedia: new Date("2024-05-01T10:00:00.000Z"),
    });

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-timeline",
      password: "pw",
      isAdmin: true,
    });
    const userP = await routeSpecAddUser(ctx, {
      name: "user-p-timeline",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro_recursive" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "user-non-timeline",
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

  function monthsUrl(): string {
    return `/api/accounts/${accountA.id}/timeline/months`;
  }

  function timelineUrl(query: string): string {
    return `/api/accounts/${accountA.id}/timeline/?${query}`;
  }

  it("rejects unauthenticated requests", async () => {
    const months = await ctx.fastify.inject({
      method: "GET",
      url: monthsUrl(),
    });
    expect(months.statusCode).toBe(403);
    const list = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3"),
    });
    expect(list.statusCode).toBe(403);
  });

  it("rejects missing or invalid year and month", async () => {
    const missing = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl(""),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(missing.statusCode).toBe(400);

    const missingMonth = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(missingMonth.statusCode).toBe(400);

    const monthTooHigh = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=13"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(monthTooHigh.statusCode).toBe(400);

    const monthZero = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=0"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(monthZero.statusCode).toBe(400);

    const badYear = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=abc&month=3"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(badYear.statusCode).toBe(400);
  });

  it("summarizes months across folders", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: monthsUrl(),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().months).toEqual([
      { year: 2024, month: 5, count: 1 },
      { year: 2024, month: 3, count: 3 },
    ]);
  });

  it("lists a month across folders with pagination", async () => {
    const full = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3&pageSize=60"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().total).toBe(3);
    expect(full.json().files.map((f: any) => f.id).sort()).toEqual(
      [p1.id, p2.id, q1.id].sort(),
    );

    const page0 = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3&sortOrder=desc&page=0&pageSize=2"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(page0.json().files).toHaveLength(2);
    expect(page0.json().total).toBe(3);

    const page1 = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3&sortOrder=desc&page=1&pageSize=2"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(page1.json().files).toHaveLength(1);
    expect(page1.json().total).toBe(3);

    const ids = [...page0.json().files, ...page1.json().files].map(
      (f: any) => f.id,
    );
    expect(new Set(ids).size).toBe(3);

    // A month with no files reports an empty page and a zero total.
    const empty = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=1"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().files).toEqual([]);
    expect(empty.json().total).toBe(0);
  });

  it("excludes trashed files from months and month listings", async () => {
    await ctx.fileData.FileDataTrash(ctx.span, p1.id);
    await ctx.fileData.FileDataTrash(ctx.span, q2.id);

    const months = await ctx.fastify.inject({
      method: "GET",
      url: monthsUrl(),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(months.json().months).toEqual([{ year: 2024, month: 3, count: 2 }]);

    const list = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3"),
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(list.json().total).toBe(2);
    expect(list.json().files.map((f: any) => f.id).sort()).toEqual(
      [p2.id, q1.id].sort(),
    );

    await ctx.fileData.FileDataRestore(ctx.span, p1.id);
    await ctx.fileData.FileDataRestore(ctx.span, q2.id);
  });

  it("filters timeline data per user grants", async () => {
    const monthsP = await ctx.fastify.inject({
      method: "GET",
      url: monthsUrl(),
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(monthsP.statusCode).toBe(200);
    expect(monthsP.json().months).toEqual([{ year: 2024, month: 3, count: 2 }]);

    const listP = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3"),
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(listP.json().total).toBe(2);
    expect(listP.json().files.map((f: any) => f.id).sort()).toEqual(
      [p1.id, p2.id].sort(),
    );

    const monthsNon = await ctx.fastify.inject({
      method: "GET",
      url: monthsUrl(),
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(monthsNon.json().months).toEqual([]);

    const listNon = await ctx.fastify.inject({
      method: "GET",
      url: timelineUrl("year=2024&month=3"),
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(listNon.json().total).toBe(0);
    expect(listNon.json().files).toEqual([]);
  });
});
