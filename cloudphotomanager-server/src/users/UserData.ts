import { Span } from "@opentelemetry/sdk-trace-base";
import * as _ from "lodash";
import { User } from "../model/User";
import { StandardTracer } from "../utils-std-ts/StandardTracer";
import { SqlDbutils } from "../utils-std-ts/SqlDbUtils";

export class UserData {
  //
  public static async get(context: Span, id: string): Promise<User> {
    const span = StandardTracer.startSpan("UserData_get", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM users WHERE id=?", [id]);
    let user: User = null;
    if (rawData.length > 0) {
      user = UserData.fromRaw(rawData[0]);
    }
    span.end();
    return user;
  }

  public static async getByName(context: Span, name: string): Promise<User> {
    const span = StandardTracer.startSpan("UserData_getByName", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM users WHERE name=?", [name]);
    let user: User = null;
    if (rawData.length > 0) {
      user = UserData.fromRaw(rawData[0]);
    }
    span.end();
    return user;
  }

  public static async list(context: Span): Promise<User[]> {
    const span = StandardTracer.startSpan("UserData_list", context);
    const rawData = await SqlDbutils.querySQL(span, "SELECT * FROM users");
    const users = [];
    for (const userRaw of rawData) {
      users.push(UserData.fromRaw(userRaw, false));
    }
    span.end();
    return users;
  }

  public static async add(context: Span, user: User): Promise<void> {
    const span = StandardTracer.startSpan("UserData_add", context);
    await SqlDbutils.execSQL(span, "INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)", [
      user.id,
      user.name,
      user.passwordEncrypted,
    ]);
    span.end();
  }

  public static async update(context: Span, user: User): Promise<void> {
    const span = StandardTracer.startSpan("UserData_update", context);
    await SqlDbutils.execSQL(span, "UPDATE users SET passwordEncrypted = ? WHERE id = ? ", [
      user.passwordEncrypted,
      user.id,
    ]);
    span.end();
  }

  public static async delete(context: Span, id: string): Promise<void> {
    const span = StandardTracer.startSpan("UserData_delete", context);
    await SqlDbutils.execSQL(span, "DELETE FROM users WHERE id = ? ", [id]);
    span.end();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static fromRaw(userRaw: any, includePasswordEncrypted = true): User {
    const user = new User();
    user.id = userRaw.id;
    user.name = userRaw.name;
    if (includePasswordEncrypted) {
      user.passwordEncrypted = userRaw.passwordEncrypted;
    }
    return user;
  }
}
