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
  AnalysisImagesIsModelError: jest.fn(() => false),
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

  it("returns identical counts for a web-client-sized batch (150 ids)", async () => {
    // The web client batches up to 150 ids per POST (DuplicateCountService
    // MAX_BATCH_IDS); pad the real ids with non-existent ones to exercise the
    // large IN list end to end.
    const fileIds = [
      fp1.id,
      fp2.id,
      fp3.id,
      fq1.id,
      fq2.id,
      ...Array.from({ length: 145 }, (_, index) => `missing-${index}`),
    ];
    const admin = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().counts).toEqual({
      [fp1.id]: 2,
      [fp2.id]: 2,
      [fp3.id]: 2,
      [fq1.id]: 2,
    });
  });

  it("ignores trashed files in duplicate groups and counts", async () => {
    await ctx.fileData.FileDataTrash(ctx.span, fp2.id, accountA.id);

    const afterTrash = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(afterTrash.json().duplicates.map((g: any) => g.hash)).toEqual([
      "dup-cross",
    ]);

    const singleton = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${fp1.id}`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(singleton.json().duplicate).toBeNull();

    const counts = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds: [fp1.id, fp3.id, fp2.id] },
    });
    expect(counts.json().counts).toEqual({ [fp3.id]: 2 });

    await ctx.fileData.FileDataRestore(ctx.span, fp2.id, accountA.id);

    const afterRestore = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(
      afterRestore
        .json()
        .duplicates.map((g: any) => g.hash)
        .sort(),
    ).toEqual(["dup-cross", "dup-in-p"]);
  });
});

describe("AnalysisRoutes bulk duplicate review", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let accountB: any;
  let folderA: any;
  let folderB: any;
  let folderShared: any;
  const files: Record<string, any[]> = {
    "gz-a1": [],
    "gz-b2": [],
    "gz-c3": [],
    "gz-shared": [],
    "gz-stale": [],
  };
  let tokenAdmin: string;
  let tokenUser: string;

  async function seedGroup(
    account: any,
    folder: any,
    hash: string,
    count: number,
  ): Promise<any[]> {
    const seeded = [];
    for (let index = 0; index < count; index++) {
      seeded.push(
        await routeSpecCreateFile(
          ctx,
          account.id,
          folder,
          `${hash}-${index}.jpg`,
          hash,
        ),
      );
    }
    return seeded;
  }

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-bulk-a");
    accountB = await routeSpecCreateAccount(ctx, "acct-bulk-b");
    folderA = await routeSpecCreateFolder(ctx, accountA.id, "/a");
    folderB = await routeSpecCreateFolder(ctx, accountA.id, "/b");
    folderShared = await routeSpecCreateFolder(ctx, accountA.id, "/shared");

    files["gz-a1"] = await seedGroup(accountA, folderA, "gz-a1", 2);
    files["gz-b2"] = await seedGroup(accountA, folderB, "gz-b2", 2);
    files["gz-c3"] = await seedGroup(accountA, folderA, "gz-c3", 3);
    files["gz-shared"] = await seedGroup(
      accountA,
      folderShared,
      "gz-shared",
      2,
    );
    files["gz-stale"] = await seedGroup(accountA, folderB, "gz-stale", 2);
    await routeSpecCreateFile(
      ctx,
      accountA.id,
      folderA,
      "unique.jpg",
      "gz-unique",
    );

    // Account B has its own copies of the shared hash: ignores are account
    // scoped, so an ignore on A must never hide B's group.
    const folderBAccount = await routeSpecCreateFolder(
      ctx,
      accountB.id,
      "/b",
    );
    await seedGroup(accountB, folderBAccount, "gz-shared", 2);

    const admin = await routeSpecAddUser(ctx, {
      name: "admin-bulk",
      password: "pw",
      isAdmin: true,
    });
    const user = await routeSpecAddUser(ctx, {
      name: "user-bulk",
      password: "pw",
      grants: [{ folderId: folderA.id, scope: "ro" }],
    });
    tokenAdmin = await routeSpecTokenFor(ctx, admin);
    tokenUser = await routeSpecTokenFor(ctx, user);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("paginates duplicate groups with a stable order and a total", async () => {
    const page0 = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates?page=0&pageSize=2`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(page0.statusCode).toBe(200);
    expect(page0.json().page).toBe(0);
    expect(page0.json().pageSize).toBe(2);
    expect(page0.json().total).toBe(5);
    expect(page0.json().duplicates.map((g: any) => g.hash)).toEqual([
      "gz-a1",
      "gz-b2",
    ]);

    const page1 = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates?page=1&pageSize=2`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(page1.json().duplicates.map((g: any) => g.hash)).toEqual([
      "gz-c3",
      "gz-shared",
    ]);
    const page2 = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates?page=2&pageSize=2`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(page2.json().duplicates.map((g: any) => g.hash)).toEqual([
      "gz-stale",
    ]);
    expect(page2.json().total).toBe(5);

    const allHashes = [
      ...page0.json().duplicates,
      ...page1.json().duplicates,
      ...page2.json().duplicates,
    ].map((g: any) => g.hash);
    expect(allHashes.sort()).toEqual([
      "gz-a1",
      "gz-b2",
      "gz-c3",
      "gz-shared",
      "gz-stale",
    ]);
    expect(new Set(allHashes).size).toBe(allHashes.length);

    // Every copy of a page's group is returned, not just the first two.
    const threeCopies = page1
      .json()
      .duplicates.find((g: any) => g.hash === "gz-c3");
    expect(threeCopies.files.length).toBe(3);

    const pastEnd = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates?page=99&pageSize=2`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(pastEnd.json().duplicates).toEqual([]);
    expect(pastEnd.json().total).toBe(5);

    for (const query of ["pageSize=0", "pageSize=201", "page=abc"]) {
      const invalid = await ctx.fastify.inject({
        method: "GET",
        url: `/api/accounts/${accountA.id}/analysis/duplicates?${query}`,
        headers: routeSpecAuthHeaders(tokenAdmin),
      });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it("persists an ignore, removes it from list and counts, and is reversible", async () => {
    const ignored = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-b2"] },
    });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json().ignored).toBe(1);

    const list = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(list.json().total).toBe(4);
    expect(list.json().duplicates.map((g: any) => g.hash)).not.toContain(
      "gz-b2",
    );

    const counts = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds: files["gz-b2"].map((f) => f.id) },
    });
    expect(counts.json().counts).toEqual({});

    // Repeating the ignore is a no-op.
    const repeated = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-b2"] },
    });
    expect(repeated.json().ignored).toBe(0);

    const ignoredList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignored`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(ignoredList.statusCode).toBe(200);
    expect(ignoredList.json().ignores).toHaveLength(1);
    expect(ignoredList.json().ignores[0].hash).toBe("gz-b2");
    expect(ignoredList.json().ignores[0].info.fileCount).toBe(2);

    // The ignored group no longer surfaces in the file-level lookup.
    const fileLookup = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/${files["gz-b2"][0].id}`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(fileLookup.json().duplicate).toBeNull();

    const unignored = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/unignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-b2"] },
    });
    expect(unignored.json().unignored).toBe(1);

    const restoredList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(restoredList.json().total).toBe(5);
    const restoredCounts = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/counts`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { fileIds: files["gz-b2"].map((f) => f.id) },
    });
    expect(restoredCounts.json().counts).toEqual({
      [files["gz-b2"][0].id]: 2,
      [files["gz-b2"][1].id]: 2,
    });
  });

  it("scopes ignores to the account", async () => {
    const ignored = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-shared"] },
    });
    expect(ignored.json().ignored).toBe(1);

    const accountAList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(accountAList.json().total).toBe(4);

    const accountBList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountB.id}/analysis/duplicates`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(accountBList.json().total).toBe(1);
    expect(accountBList.json().duplicates[0].hash).toBe("gz-shared");

    await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/unignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-shared"] },
    });
  });

  it("restricts ignore management to admins and validates the payload", async () => {
    const nonAdminIgnored = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignored`,
      headers: routeSpecAuthHeaders(tokenUser),
    });
    expect(nonAdminIgnored.statusCode).toBe(403);
    const nonAdminIgnore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenUser),
      payload: { hashes: ["gz-a1"] },
    });
    expect(nonAdminIgnore.statusCode).toBe(403);
    const nonAdminUnignore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/unignore`,
      headers: routeSpecAuthHeaders(tokenUser),
      payload: { hashes: ["gz-a1"] },
    });
    expect(nonAdminUnignore.statusCode).toBe(403);

    const anonymousIgnored = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignored`,
    });
    expect(anonymousIgnored.statusCode).toBe(403);
    const anonymousIgnore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      payload: { hashes: ["gz-a1"] },
    });
    expect(anonymousIgnore.statusCode).toBe(403);
    const anonymousUnignore = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/unignore`,
      payload: { hashes: ["gz-a1"] },
    });
    expect(anonymousUnignore.statusCode).toBe(403);

    for (const payload of [
      {},
      { hashes: [] },
      { hashes: ["gz-a1", ""] },
      { hashes: [42] },
      {
        hashes: Array.from({ length: 201 }, (_, index) => `hash-${index}`),
      },
    ]) {
      const invalid = await ctx.fastify.inject({
        method: "POST",
        url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
        headers: routeSpecAuthHeaders(tokenAdmin),
        payload,
      });
      expect(invalid.statusCode).toBe(400);
    }

    // Only hashes that currently form a group are persisted.
    const notAGroup = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-unique", "no-such-hash"] },
    });
    expect(notAGroup.json().ignored).toBe(0);
    const ignoredList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignored`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(ignoredList.json().ignores).toEqual([]);
  });

  it("prunes an ignore once its group no longer has two copies", async () => {
    const ignored = await ctx.fastify.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignore`,
      headers: routeSpecAuthHeaders(tokenAdmin),
      payload: { hashes: ["gz-stale"] },
    });
    expect(ignored.json().ignored).toBe(1);

    for (const file of files["gz-stale"]) {
      await ctx.fileData.FileDataDelete(ctx.span, file.id, accountA.id);
    }

    const ignoredList = await ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/analysis/duplicates/ignored`,
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(ignoredList.json().ignores).toEqual([]);
  });
});
