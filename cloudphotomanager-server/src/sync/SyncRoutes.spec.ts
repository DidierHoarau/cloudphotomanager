import { SqlDbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
import {
  routeSpecAuthHeaders,
  routeSpecAddUser,
  routeSpecCookieFromResponse,
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

async function seedQueueItem(
  ctx: RouteSpecContext,
  id: string,
  accountId: string,
  data: any,
  fileIds: string[] = [],
): Promise<void> {
  await SqlDbUtilsExecSQL(
    ctx.span,
    "INSERT INTO sync_queue " +
      "(id, accountId, functionName, priority, status, data, fileIds, dateCreated) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      accountId,
      "SyncInventorySyncFolder",
      2,
      "WAITING",
      JSON.stringify(data),
      JSON.stringify(fileIds),
      new Date().toISOString(),
    ],
  );
}

function itemIds(res: any): string[] {
  return res
    .json()
    .items.map((item: any) => item.id)
    .sort();
}

function waitingCount(res: any): number {
  return res.json().counts.find((c: any) => c.type === "WAITING")?.count;
}

// The WS tests use a real loopback listener instead of injectWS: injectWS
// fabricates a request without a socket, which Fastify's route handler
// rejects when an onTimeout hook is registered (as the OTel hooks do).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocketClient = require("ws");

let wsBaseUrl = "";

async function wsConnect(
  path: string,
  headers?: Record<string, string>,
): Promise<{ ws: any; closeCode: Promise<number>; firstMessage: Promise<any> }> {
  const ws = new WebSocketClient(`${wsBaseUrl}${path}`, { headers });
  // Listeners are attached before the handshake completes so an immediate
  // server-side close (1008) cannot be missed.
  const closeCode = new Promise<number>((resolve) =>
    ws.on("close", (code: number) => resolve(code)),
  );
  const firstMessage = new Promise<any>((resolve) =>
    ws.on("message", (data: any) => resolve(JSON.parse(data.toString()))),
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, closeCode, firstMessage };
}

describe("SyncRoutes permissions", () => {
  let ctx: RouteSpecContext;
  let accountA: any;
  let folderP: any;
  let folderQ: any;
  let fileP: any;
  let tokenAdmin: string;
  let tokenUserP: string;
  let tokenUserNon: string;
  let cookieUserP: string;

  beforeAll(async () => {
    ctx = await routeSpecSetup();
    accountA = await routeSpecCreateAccount(ctx, "acct-sync-a");
    folderP = await routeSpecCreateFolder(ctx, accountA.id, "/p");
    folderQ = await routeSpecCreateFolder(ctx, accountA.id, "/q");
    fileP = await routeSpecCreateFile(ctx, accountA.id, folderP, "in-p.jpg");

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

    const login = await ctx.fastify.inject({
      method: "POST",
      url: "/api/users/session",
      payload: { name: "user-p", password: "pw" },
    });
    expect(login.statusCode).toBe(201);
    cookieUserP = routeSpecCookieFromResponse(login);

    // folderId-scoped items, a fileId-scoped item and an unresolvable one.
    await seedQueueItem(ctx, "queue-item-p", accountA.id, {
      folderId: folderP.id,
    });
    await seedQueueItem(ctx, "queue-item-q", accountA.id, {
      folderId: folderQ.id,
    });
    await seedQueueItem(ctx, "queue-item-file", accountA.id, {}, [fileP.id]);
    await seedQueueItem(ctx, "queue-item-unknown", accountA.id, {
      folderId: "no-such-folder",
    });

    wsBaseUrl = (
      await ctx.fastify.listen({ port: 0, host: "127.0.0.1" })
    ).replace(/^http/, "ws");
  });

  afterAll(async () => {
    await ctx.fastify.close();
  });

  it("rejects unauthenticated queue and status requests", async () => {
    const queue = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/queue",
    });
    expect(queue.statusCode).toBe(403);
    const status = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/status",
    });
    expect(status.statusCode).toBe(403);
  });

  it("filters the queue per user permissions", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/queue",
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    expect(itemIds(admin)).toEqual([
      "queue-item-file",
      "queue-item-p",
      "queue-item-q",
      "queue-item-unknown",
    ]);
    expect(waitingCount(admin)).toBe(4);

    // user-p sees the /p folder item and the item resolved through the
    // file in /p, but not the /q or the unresolvable items.
    const userP = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/queue",
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(userP.statusCode).toBe(200);
    expect(itemIds(userP)).toEqual(["queue-item-file", "queue-item-p"]);
    expect(waitingCount(userP)).toBe(2);

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/queue",
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(userNon.statusCode).toBe(200);
    expect(itemIds(userNon)).toEqual([]);
    expect(waitingCount(userNon)).toBe(0);
  });

  it("filters the status counts per user permissions", async () => {
    const admin = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/status",
      headers: routeSpecAuthHeaders(tokenAdmin),
    });
    expect(admin.statusCode).toBe(200);
    expect(
      admin.json().sync.find((c: any) => c.type === "WAITING").count,
    ).toBe(4);

    const userP = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/status",
      headers: routeSpecAuthHeaders(tokenUserP),
    });
    expect(
      userP.json().sync.find((c: any) => c.type === "WAITING").count,
    ).toBe(2);

    const userNon = await ctx.fastify.inject({
      method: "GET",
      url: "/api/sync/status",
      headers: routeSpecAuthHeaders(tokenUserNon),
    });
    expect(
      userNon.json().sync.find((c: any) => c.type === "WAITING").count,
    ).toBe(0);
  });

  it(
    "rejects WebSocket upgrades without credentials or with a query token",
    async () => {
      const anonymous = await wsConnect("/api/sync/ws");
      expect(await anonymous.closeCode).toBe(1008);

      // Tokens in the query string are no longer accepted (B2).
      const queryToken = await wsConnect(`/api/sync/ws?token=${tokenUserP}`);
      expect(await queryToken.closeCode).toBe(1008);
    },
    15000,
  );

  it(
    "accepts the session cookie for WebSocket upgrades",
    async () => {
      const { ws, firstMessage, closeCode } = await wsConnect("/api/sync/ws", {
        cookie: cookieUserP,
      });
      const message = await firstMessage;
      expect(message.type).toBe("queue_update");
      expect(message.items.map((item: any) => item.id).sort()).toEqual([
        "queue-item-file",
        "queue-item-p",
      ]);
      ws.close();
      await closeCode;
    },
    15000,
  );
});
