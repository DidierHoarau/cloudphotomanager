import { Span } from "@opentelemetry/sdk-trace-base";
import { User } from "../model/User";
import { OTelTracer } from "../OTelContext";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";

export async function UserDataGet(context: Span, id: string): Promise<User> {
  const span = OTelTracer().startSpan("UserData_get", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM users WHERE id=?",
    [id],
  );
  let user: User = null;
  if (rawData.length > 0) {
    user = fromRaw(rawData[0]);
  }
  span.end();
  return user;
}

export async function UserDataGetByName(
  context: Span,
  name: string,
): Promise<User> {
  const span = OTelTracer().startSpan("UserData_getByName", context);
  const rawData = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM users WHERE name=?",
    [name],
  );
  let user: User = null;
  if (rawData.length > 0) {
    user = fromRaw(rawData[0]);
  }
  span.end();
  return user;
}

export async function UserDataList(context: Span): Promise<User[]> {
  const span = OTelTracer().startSpan("UserData_list", context);
  const rawData = await SqlDbUtilsQuerySQL(span, "SELECT * FROM users");
  const users = [];
  for (const userRaw of rawData) {
    users.push(fromRaw(userRaw, false));
  }
  span.end();
  return users;
}

export async function UserDataAdd(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UserData_add", context);
  UserDataAddStatement(span, user);
  span.end();
}

// Runs the user insert with no transaction of its own; call inside
// `SqlDbUtilsGetDatabase().transaction(...)` when other writes must be atomic
// with it (e.g. the permission row).
export function UserDataAddStatement(span: Span, user: User): void {
  SqlDbUtilsExecSQL(
    span,
    "INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)",
    [user.id, user.name, user.passwordEncrypted],
  );
}

export async function UserDataUpdate(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UserData_update", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE users SET passwordEncrypted = ? WHERE id = ? ",
    [user.passwordEncrypted, user.id],
  );
  span.end();
}

export async function UserDataDelete(context: Span, id: string): Promise<void> {
  const span = OTelTracer().startSpan("UserData_delete", context);
  UserDataDeleteStatement(span, id);
  span.end();
}

// Runs the user delete with no transaction of its own; call inside
// `SqlDbUtilsGetDatabase().transaction(...)` when other writes must be atomic
// with it (e.g. the permission row).
export function UserDataDeleteStatement(span: Span, id: string): void {
  SqlDbUtilsExecSQL(span, "DELETE FROM users WHERE id = ? ", [id]);
}

// private Function

function fromRaw(userRaw: any, includePasswordEncrypted = true): User {
  const user = new User();
  user.id = userRaw.id;
  user.name = userRaw.name;
  if (includePasswordEncrypted) {
    user.passwordEncrypted = userRaw.passwordEncrypted;
  }
  return user;
}
