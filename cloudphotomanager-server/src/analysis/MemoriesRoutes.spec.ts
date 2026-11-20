import { SqlDbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
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

const FIXED_DATE = "2024-03-15";

describe("MemoriesRoutes", () => {
  let ctx: RouteSpecContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    const admin = await routeSpecAddUser(ctx, {
      name: "memories-admin",
      password: "pw",
      isAdmin: true,
    });
    adminToken = await routeSpecTokenFor(ctx, admin);
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  async function memoriesRequest(
    token: string | null,
    accountId: string,
    date?: string,
  ) {
    return ctx.fastify.inject({
      method: "GET",
      url: `/api/accounts/${accountId}/memories${
        date === undefined ? "" : `?date=${encodeURIComponent(date)}`
      }`,
      headers: token ? routeSpecAuthHeaders(token) : {},
    });
  }

  async function createAccount(name: string) {
    const account = await routeSpecCreateAccount(ctx, name);
    const folder = await routeSpecCreateFolder(ctx, account.id, "/p");
    return { account, folder };
  }

  async function createDatedFile(
    accountId: string,
    folder: any,
    filename: string,
    dateIso: string,
    hash?: string,
  ) {
    const file = await routeSpecCreateFile(
      ctx,
      accountId,
      folder,
      filename,
      hash,
    );
    await routeSpecSetFileMeta(ctx, file, { dateMedia: new Date(dateIso) });
    return file;
  }

  function idsOf(section: any): string[] {
    return section.files.map((file: any) => file.id);
  }

  function sectionByKey(body: any, key: string): any {
    return body.sections.find((section: any) => section.key === key);
  }

  it("returns 403 without a token", async () => {
    const { account } = await createAccount("memories-anon");
    const res = await memoriesRequest(null, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Access Denied" });
  });

  it("validates the date parameter and defaults to today", async () => {
    const { account } = await createAccount("memories-dates");
    for (const invalid of ["2024-02-30", "2024-13-01", "abc", "2024-3-15"]) {
      const res = await memoriesRequest(adminToken, account.id, invalid);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: "Invalid parameter: date (expected YYYY-MM-DD)",
      });
    }
    const res = await memoriesRequest(adminToken, account.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the three sections in the fixed order", async () => {
    const { account } = await createAccount("memories-order");
    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(200);
    expect(res.json().sections.map((section: any) => section.key)).toEqual([
      "onThisDay",
      "pastWeek",
      "monthHighlights",
    ]);
  });

  it("selects the right files for each section", async () => {
    const { account, folder } = await createAccount("memories-sections");
    const onThisDay = await createDatedFile(
      account.id,
      folder,
      "on-this-day.jpg",
      "2023-03-15T12:00:00Z",
    );
    const sameDay2024 = await createDatedFile(
      account.id,
      folder,
      "same-day-2024.jpg",
      "2024-03-15T10:00:00Z",
    );
    const weekStart = await createDatedFile(
      account.id,
      folder,
      "week-start.jpg",
      "2024-03-09T00:00:00Z",
    );
    const weekEnd = await createDatedFile(
      account.id,
      folder,
      "week-end.jpg",
      "2024-03-15T23:59:59Z",
    );
    await createDatedFile(
      account.id,
      folder,
      "before-week.jpg",
      "2024-03-08T23:59:59Z",
    );
    await createDatedFile(
      account.id,
      folder,
      "after-week.jpg",
      "2024-03-16T00:00:00Z",
    );
    const highlightFavorite = await createDatedFile(
      account.id,
      folder,
      "highlight-fav.jpg",
      "2021-03-20T12:00:00Z",
    );
    const highlightOld = await createDatedFile(
      account.id,
      folder,
      "highlight-old.jpg",
      "2022-03-10T12:00:00Z",
    );
    await createDatedFile(
      account.id,
      folder,
      "highlight-out.jpg",
      "2021-04-10T12:00:00Z",
    );
    await ctx.fileData.FileDataUpdateFavorite(
      ctx.span,
      highlightFavorite.id,
      true,
    );

    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(idsOf(sectionByKey(body, "onThisDay"))).toEqual([onThisDay.id]);
    const pastWeekIds = idsOf(sectionByKey(body, "pastWeek"));
    expect(pastWeekIds).toHaveLength(3);
    expect(pastWeekIds).toContain(sameDay2024.id);
    expect(pastWeekIds).toContain(weekStart.id);
    expect(pastWeekIds).toContain(weekEnd.id);
    // Favorites first, then newest; earlier Marches only.
    expect(idsOf(sectionByKey(body, "monthHighlights"))).toEqual([
      highlightFavorite.id,
      highlightOld.id,
    ]);
    // Cross-section: the 2023 file only appears once, in onThisDay.
    const allIds = body.sections.flatMap((section: any) => idsOf(section));
    expect(allIds.filter((id: string) => id === onThisDay.id)).toHaveLength(1);
  });

  it("excludes trashed, sync-gone, outtake, unknown and undated files", async () => {
    const { account, folder } = await createAccount("memories-exclusions");
    const kept = await createDatedFile(
      account.id,
      folder,
      "kept.jpg",
      "2024-03-15T09:00:00Z",
    );
    const trashed = await createDatedFile(
      account.id,
      folder,
      "trashed.jpg",
      "2024-03-15T10:00:00Z",
    );
    const gone = await createDatedFile(
      account.id,
      folder,
      "gone.jpg",
      "2024-03-15T11:00:00Z",
    );
    const outtake = await createDatedFile(
      account.id,
      folder,
      "shot-outtake.jpg",
      "2024-03-15T12:00:00Z",
    );
    const unknown = await createDatedFile(
      account.id,
      folder,
      "notes.txt",
      "2024-03-15T13:00:00Z",
    );
    const undated = await routeSpecCreateFile(
      ctx,
      account.id,
      folder,
      "undated.jpg",
    );
    await SqlDbUtilsExecSQL(
      ctx.span,
      "UPDATE files SET dateMedia = NULL WHERE id = ?",
      [undated.id],
    );
    await ctx.fileData.FileDataTrash(ctx.span, trashed.id, account.id);
    await ctx.fileData.FileDataMarkSyncGone(ctx.span, gone.id, "gone");

    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const allIds = body.sections.flatMap((section: any) => idsOf(section));
    expect(allIds).toEqual([kept.id]);
    expect(allIds).not.toContain(trashed.id);
    expect(allIds).not.toContain(gone.id);
    expect(allIds).not.toContain(outtake.id);
    expect(allIds).not.toContain(unknown.id);
    expect(allIds).not.toContain(undated.id);
  });

  it("keeps one copy per non-empty hash and does not dedupe empty hashes", async () => {
    const { account, folder } = await createAccount("memories-duplicates");
    const duplicateLate = await createDatedFile(
      account.id,
      folder,
      "dup-late.jpg",
      "2024-03-15T11:00:00Z",
      "shared-hash",
    );
    await createDatedFile(
      account.id,
      folder,
      "dup-early.jpg",
      "2024-03-15T10:00:00Z",
      "shared-hash",
    );
    const emptyLate = await createDatedFile(
      account.id,
      folder,
      "empty-late.jpg",
      "2024-03-15T09:00:00Z",
      "",
    );
    const emptyEarly = await createDatedFile(
      account.id,
      folder,
      "empty-early.jpg",
      "2024-03-15T08:00:00Z",
      "",
    );

    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(200);
    const pastWeekIds = idsOf(sectionByKey(res.json(), "pastWeek"));
    expect(pastWeekIds).toHaveLength(3);
    expect(pastWeekIds).toContain(duplicateLate.id);
    expect(pastWeekIds).toContain(emptyLate.id);
    expect(pastWeekIds).toContain(emptyEarly.id);
  });

  it("collapses bursts within a folder and keeps other shots", async () => {
    const { account, folder } = await createAccount("memories-bursts");
    const otherFolder = await routeSpecCreateFolder(ctx, account.id, "/q");
    const burstEarly = await createDatedFile(
      account.id,
      folder,
      "burst-early.jpg",
      "2024-03-15T12:00:00.000Z",
    );
    const burstLate = await createDatedFile(
      account.id,
      folder,
      "burst-late.jpg",
      "2024-03-15T12:00:01.500Z",
    );
    const apartEarly = await createDatedFile(
      account.id,
      folder,
      "apart-early.jpg",
      "2024-03-15T13:00:00.000Z",
    );
    const apartLate = await createDatedFile(
      account.id,
      folder,
      "apart-late.jpg",
      "2024-03-15T13:00:05.000Z",
    );
    const crossOne = await createDatedFile(
      account.id,
      folder,
      "cross-one.jpg",
      "2024-03-15T14:00:00.000Z",
    );
    const crossTwo = await createDatedFile(
      account.id,
      otherFolder,
      "cross-two.jpg",
      "2024-03-15T14:00:00.000Z",
    );

    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    expect(res.statusCode).toBe(200);
    const pastWeekIds = idsOf(sectionByKey(res.json(), "pastWeek"));
    expect(pastWeekIds).toHaveLength(5);
    expect(pastWeekIds).toContain(burstLate.id);
    expect(pastWeekIds).not.toContain(burstEarly.id);
    expect(pastWeekIds).toContain(apartEarly.id);
    expect(pastWeekIds).toContain(apartLate.id);
    expect(pastWeekIds).toContain(crossOne.id);
    expect(pastWeekIds).toContain(crossTwo.id);
  });

  it("respects folder permissions per section", async () => {
    const { account, folder: folderP } = await createAccount(
      "memories-permissions",
    );
    const folderQ = await routeSpecCreateFolder(ctx, account.id, "/q");
    const fileP = await createDatedFile(
      account.id,
      folderP,
      "permitted.jpg",
      "2024-03-15T10:00:00Z",
    );
    const fileQ = await createDatedFile(
      account.id,
      folderQ,
      "forbidden.jpg",
      "2024-03-15T10:00:00Z",
    );
    const userP = await routeSpecAddUser(ctx, {
      name: "memories-user-p",
      password: "pw",
      grants: [{ folderId: folderP.id, scope: "ro" }],
    });
    const userNon = await routeSpecAddUser(ctx, {
      name: "memories-user-non",
      password: "pw",
      grants: [],
    });
    const tokenUserP = await routeSpecTokenFor(ctx, userP);
    const tokenUserNon = await routeSpecTokenFor(ctx, userNon);

    const resP = await memoriesRequest(tokenUserP, account.id, FIXED_DATE);
    expect(resP.statusCode).toBe(200);
    const idsP = resP
      .json()
      .sections.flatMap((section: any) => idsOf(section));
    expect(idsP).toEqual([fileP.id]);

    const resNon = await memoriesRequest(tokenUserNon, account.id, FIXED_DATE);
    expect(resNon.statusCode).toBe(200);
    expect(resNon.json().sections).toHaveLength(3);
    for (const section of resNon.json().sections) {
      expect(section.files).toEqual([]);
    }

    const resAdmin = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    const idsAdmin = resAdmin
      .json()
      .sections.flatMap((section: any) => idsOf(section));
    expect(idsAdmin).toContain(fileP.id);
    expect(idsAdmin).toContain(fileQ.id);
  });

  it("attaches signed media URLs to returned files", async () => {
    const { account, folder } = await createAccount("memories-urls");
    await createDatedFile(
      account.id,
      folder,
      "signed.jpg",
      "2024-03-15T10:00:00Z",
    );
    const res = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    const file = sectionByKey(res.json(), "pastWeek").files[0];
    expect(file.thumbnailUrl).toEqual(expect.any(String));
    expect(file.thumbnailUrl.length).toBeGreaterThan(0);
    expect(file.previewUrl).toEqual(expect.any(String));
    expect(file.previewUrl.length).toBeGreaterThan(0);
  });

  it("is deterministic across identical requests", async () => {
    const { account, folder } = await createAccount("memories-determinism");
    await createDatedFile(
      account.id,
      folder,
      "det-one.jpg",
      "2024-03-15T10:00:00Z",
    );
    await createDatedFile(
      account.id,
      folder,
      "det-two.jpg",
      "2024-03-10T10:00:00Z",
    );
    const first = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    const second = await memoriesRequest(adminToken, account.id, FIXED_DATE);
    const sequence = (body: any) =>
      body.sections.map((section: any) => ({
        key: section.key,
        ids: idsOf(section),
      }));
    expect(sequence(second.json())).toEqual(sequence(first.json()));
  });
});
