import { Span } from "@opentelemetry/sdk-trace-base";
import { UserPermission } from "../model/UserPermission";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsGetDatabase,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

export async function UserPermissionDataGetForUser(
  context: Span,
  userId: string,
): Promise<UserPermission> {
  const span = OTelTracer().startSpan("UserPermissionData_get", context);
  try {
    const rawData = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM users_permissions WHERE userId=?",
      [userId],
    );
    if (rawData.length === 0) {
      const emptyPermission = new UserPermission();
      emptyPermission.userId = userId;
      return emptyPermission;
    }
    return fromRaw(rawData[0]);
  } finally {
    span.end();
  }
}

export async function UserPermissionDataUpdateForUser(
  context: Span,
  userId: string,
  userPermission: UserPermission,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "UserPermissionData_updateForUser",
    context,
  );
  try {
    const apply = SqlDbUtilsGetDatabase().transaction(() => {
      UserPermissionDataUpdateForUserStatement(span, userId, userPermission);
    });
    apply();
  } finally {
    span.end();
  }
}

// Runs the permission row replacement with no transaction of its own; call
// inside `SqlDbUtilsGetDatabase().transaction(...)` when other writes must be
// atomic with it (e.g. user creation).
export function UserPermissionDataUpdateForUserStatement(
  span: Span,
  userId: string,
  userPermission: UserPermission,
): void {
  SqlDbUtilsExecSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [
    userId,
  ]);
  SqlDbUtilsExecSQL(
    span,
    "INSERT INTO users_permissions (id, userid, info) " + "VALUES (?, ?,?)",
    [userPermission.id, userId, JSON.stringify(userPermission.toJson().info)],
  );
}

export async function UserPermissionDataDeleteForUser(
  context: Span,
  userId: string,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "UserPermissionData_deleteForUser",
    context,
  );
  try {
    UserPermissionDataDeleteForUserStatement(span, userId);
  } finally {
    span.end();
  }
}

// Runs the permission row deletion with no transaction of its own; call
// inside `SqlDbUtilsGetDatabase().transaction(...)` when other writes must be
// atomic with it (e.g. user deletion).
export function UserPermissionDataDeleteForUserStatement(
  span: Span,
  userId: string,
): void {
  SqlDbUtilsExecSQL(span, "DELETE FROM users_permissions WHERE userId = ?", [
    userId,
  ]);
}

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
