import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { UserPermission } from "../model/UserPermission";

describe("UserPermissionData", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let userPermissionData: typeof import("./UserPermissionData");

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-perm-spec-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("UserPermissionData.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    userPermissionData = await import("./UserPermissionData");
  });

  function makePermission(
    userId: string,
    isAdmin = false,
    folders: any[] = [],
  ): UserPermission {
    const permission = new UserPermission();
    permission.userId = userId;
    permission.info.isAdmin = isAdmin;
    permission.info.folders = folders;
    return permission;
  }

  it("returns an empty permission object when the user has no row", async () => {
    const permission = await userPermissionData.UserPermissionDataGetForUser(
      span,
      "user-without-row",
    );
    expect(permission.userId).toBe("user-without-row");
    expect(permission.info.isAdmin).toBe(false);
    expect(permission.info.folders).toEqual([]);
  });

  it("stores and reloads a permission row", async () => {
    const permission = makePermission(
      "user-1",
      false,
      [{ folderId: "f1", scope: "ro" }],
    );
    await userPermissionData.UserPermissionDataUpdateForUser(
      span,
      "user-1",
      permission,
    );

    const reloaded = await userPermissionData.UserPermissionDataGetForUser(
      span,
      "user-1",
    );
    expect(reloaded.info.isAdmin).toBe(false);
    expect(reloaded.info.folders).toEqual([{ folderId: "f1", scope: "ro" }]);
  });

  it("rolls back the delete when the insert fails", async () => {
    // Give user-2 a row, then attempt an update whose unique id collides
    // with user-1's row: the DELETE must be rolled back so user-2 keeps its
    // previous permissions.
    const initial = makePermission("user-2", true);
    await userPermissionData.UserPermissionDataUpdateForUser(
      span,
      "user-2",
      initial,
    );

    const user1Row = await SqlDbUtilsQuerySQL(
      span,
      "SELECT id FROM users_permissions WHERE userId = ?",
      ["user-1"],
    );
    const conflicting = makePermission("user-2");
    conflicting.id = user1Row[0].id; // UNIQUE violation on insert

    await expect(
      userPermissionData.UserPermissionDataUpdateForUser(
        span,
        "user-2",
        conflicting,
      ),
    ).rejects.toBeDefined();

    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM users_permissions WHERE userId = ?",
      ["user-2"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(initial.id);

    // The conflicting user-1 row is untouched.
    const user1Rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM users_permissions WHERE userId = ?",
      ["user-1"],
    );
    expect(user1Rows).toHaveLength(1);
  });

  it("rolls back the delete when the delete statement itself is the failing one", async () => {
    const victim = makePermission("user-transaction-rollback", false, [
      { folderId: "keep-me", scope: "ro" },
    ]);
    await userPermissionData.UserPermissionDataUpdateForUser(
      span,
      "user-transaction-rollback",
      victim,
    );

    // The insert of a permission without id violates NOT NULL on insert and
    // must roll the DELETE back.
    const broken = makePermission("user-transaction-rollback");
    broken.id = null;

    await expect(
      userPermissionData.UserPermissionDataUpdateForUser(
        span,
        "user-transaction-rollback",
        broken,
      ),
    ).rejects.toBeDefined();

    const rows = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM users_permissions WHERE userId = ?",
      ["user-transaction-rollback"],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].info).folders).toEqual([
      { folderId: "keep-me", scope: "ro" },
    ]);
  });
});
