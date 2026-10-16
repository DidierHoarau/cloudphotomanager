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

jest.mock("../analysis/AnalysisImages", () => ({
  AnalysisImagesGetLabels: jest.fn().mockResolvedValue([]),
  AnalysisImagesInit: jest.fn(),
}));

describe("RoutesFileOperationsFavorite", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let fileOne: any;
  let fileTwo: any;
  let tokenAdmin: string;
  let tokenUserP: string;

  const favoriteUrl = (accountId: string) =>
    `/api/accounts/${accountId}/files/batch/operations/fileFavorite`;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-favorite-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    fileOne = await routeSpecCreateFile(ctx, accountA.id, folderP, "one.jpg");
    fileTwo = await routeSpecCreateFile(ctx, accountA.id, folderP, "two.jpg");

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-favorite",
      password: "pw",
      isAdmin: true,
    });
    const userP = await routeSpecAddUser(ctx, {
      name: "user-p-favorite",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUserP = await routeSpecTokenFor(ctx, userP);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  async function listFolderFiles(
    token: string,
    query = "",
  ): Promise<{ statusCode: number; files: any[]; total: number }> {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/folders/${folderP.id}/files-recursive${query}`,
      headers: routeSpecAuthHeaders(token),
    });
    return {
      statusCode: res.statusCode,
      files: res.json().files || [],
      total: res.json().total,
    };
  }

  it("rejects unauthenticated requests", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      payload: { fileIdList: [fileOne.id], favorite: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects non-admin users", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenUserP),
      payload: { fileIdList: [fileOne.id], favorite: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects missing or invalid parameters", async () => {
    const missingList = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { favorite: true },
    });
    expect(missingList.statusCode).toBe(400);

    const emptyList = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [], favorite: true },
    });
    expect(emptyList.statusCode).toBe(400);

    const missingFavorite = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id] },
    });
    expect(missingFavorite.statusCode).toBe(400);

    const nonBooleanFavorite = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id], favorite: "yes" },
    });
    expect(nonBooleanFavorite.statusCode).toBe(400);
  });

  it("toggles the favorite flag on and off for a batch", async () => {
    const set = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id, fileTwo.id], favorite: true },
    });
    expect(set.statusCode).toBe(200);

    let listing = await listFolderFiles(tokenAdmin, "?favoriteOnly=true");
    expect(listing.statusCode).toBe(200);
    expect(listing.total).toBe(2);
    expect(listing.files.map((f: any) => f.id).sort()).toEqual(
      [fileOne.id, fileTwo.id].sort(),
    );

    const unsetOne = await ctx.fastify.inject({
      method: "POST",
      url: favoriteUrl(accountA.id),
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIdList: [fileOne.id], favorite: false },
    });
    expect(unsetOne.statusCode).toBe(200);

    listing = await listFolderFiles(tokenAdmin, "?favoriteOnly=true");
    expect(listing.total).toBe(1);
    expect(listing.files.map((f: any) => f.id)).toEqual([fileTwo.id]);

    const all = await listFolderFiles(tokenAdmin);
    expect(all.total).toBe(2);
  });
});
