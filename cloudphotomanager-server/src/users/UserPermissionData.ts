import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";
import { UserPermission } from "../model/UserPermission";

export class UserPermissionData {
  //
  public static async getForUser(context: Span, userId: string): Promise<UserPermission> {
    const span = StandardTracer.startSpan("UserPermissionData_get", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM users_permissions WHERE userId=?", [userId]);
    if (rawData.length === 0) {
      const emptyPermission = new UserPermission();
      emptyPermission.userId = userId;
      return emptyPermission;
    }
    const userPermission = fromRaw(rawData[0]);
    span.end();
    return userPermission;
  }

  public static async updateForUser(context: Span, userId: string, userPermission: UserPermission): Promise<void> {
    const span = StandardTracer.startSpan("UserPermissionData_updateForUser", context);
    SqlDbutils.execSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [userId]);
    SqlDbutils.execSQL(span, "INSERT INTO users_permissions (id, userid, info) " + "VALUES (?, ?,?)", [
      userPermission.id,
      userId,
      JSON.stringify(userPermission.toJson().info),
    ]);
    span.end();
  }

  public static async deleteForUser(context: Span, userId: string): Promise<void> {
    const span = StandardTracer.startSpan("UserPermissionData_deleteForUser", context);
    SqlDbutils.execSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [userId]);
    span.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(json: any): UserPermission {
  if (!json) {
    return null;
  }
  const permission = new UserPermission();
  if (!json.info) {
    throw new Error("Permission Object Info Undefined");
  }
  permission.id = json.id;
  permission.userId = json.userId;
  permission.info = JSON.parse(json.info);
  return permission;
}
