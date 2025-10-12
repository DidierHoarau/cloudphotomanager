import { Span } from "@opentelemetry/sdk-trace-base";
import { UserPermission } from "../model/UserPermission";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";

export async function UserPermissionDataGetForUser(
  context: Span,
  userId: string
): Promise<UserPermission> {
  const span = OTelTracer().startSpan("UserPermissionData_get", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM users_permissions WHERE userId=?",
    [userId]
  );
  if (rawData.length === 0) {
    const emptyPermission = new UserPermission();
    emptyPermission.userId = userId;
    return emptyPermission;
  }
  const userPermission = fromRaw(rawData[0]);
  span.end();
  return userPermission;
}

export async function UserPermissionDataUpdateForUser(
  context: Span,
  userId: string,
  userPermission: UserPermission
): Promise<void> {
  const span = OTelTracer().startSpan(
    "UserPermissionData_updateForUser",
    context
  );
  SqlDbUtilsExecSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [
    userId,
  ]);
  SqlDbUtilsExecSQL(
    span,
    "INSERT INTO users_permissions (id, userid, info) " + "VALUES (?, ?,?)",
    [userPermission.id, userId, JSON.stringify(userPermission.toJson().info)]
  );
  span.end();
}

export async function UserPermissionDataDeleteForUser(
  context: Span,
  userId: string
): Promise<void> {
  const span = OTelTracer().startSpan(
    "UserPermissionData_deleteForUser",
    context
  );
  SqlDbUtilsExecSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [
    userId,
  ]);
  span.end();
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
