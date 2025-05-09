import { Database } from "sqlite3";
import { Config } from "../Config";
import * as fs from "fs-extra";
import { Logger } from "./Logger";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "./StandardTracer";

const logger = new Logger("SqlDbutils");
const SQL_DIR = `${__dirname}/../../sql`;

let database;

export class SqlDbutils {
  //
  public static async init(context: Span, config: Config): Promise<void> {
    const span = StandardTracerStartSpan("SqlDbutils_init", context);
    await fs.ensureDir(config.DATA_DIR);
    if (config.DATABASE_ASYNC_WRITE) {
      if (fs.existsSync(`${config.DATA_DIR}/database.db`)) {
        await fs.rm("/tmp/database-async.db").catch(() => {
          // Nothing
        });
        await fs.copyFile(`${config.DATA_DIR}/database.db`, "/tmp/database-async.db");
      }
      database = new Database("/tmp/database-async.db");
      setInterval(() => {
        database.backup(`${config.DATA_DIR}/database.db`, (err) => {
          if (err) {
            logger.error(`Error backing up database: ${err}`);
          } else {
            logger.info("Database backed up successfully!");
          }
        });
      }, 5 * 60 * 1000); // 5 minutes
    } else {
      database = new Database(`${config.DATA_DIR}/database.db`);
    }
    await SqlDbutils.execSQLFile(span, `${SQL_DIR}/init-0000.sql`);
    const dbVersionQuery = await SqlDbutils.querySQL(
      span,
      "SELECT MAX(value) as maxVerion FROM metadata WHERE type='db_version'"
    );
    const initFiles = (await await fs.readdir(`${SQL_DIR}`)).sort();
    let dbVersionApplied = 0;

    if (dbVersionQuery[0].maxVerion) {
      dbVersionApplied = Number(dbVersionQuery[0].maxVerion);
    }

    logger.info(`Current DB Version: ${dbVersionApplied}`);
    for (const initFile of initFiles) {
      const regex = /init-(\d+).sql/g;
      const match = regex.exec(initFile);
      if (match) {
        const dbVersionInitFile = Number(match[1]);
        if (dbVersionInitFile > dbVersionApplied) {
          logger.info(`Loading init file: ${initFile}`);
          await SqlDbutils.execSQLFile(span, `${SQL_DIR}/${initFile}`);
          await SqlDbutils.querySQL(span, 'INSERT INTO metadata (type, value, dateCreated) VALUES ("db_version",?,?)', [
            dbVersionInitFile,
            new Date().toISOString(),
          ]);
        }
      }
    }
    span.end();
  }

  public static execSQL(context: Span, sql: string, params = []): Promise<void> {
    const span = StandardTracerStartSpan("SqlDbutils_execSQL", context);
    return new Promise((resolve, reject) => {
      database.run(sql, params, (error, res) => {
        span.end();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  public static async execSQLFile(context: Span, filename: string): Promise<void> {
    const span = StandardTracerStartSpan("SqlDbutils_execSQLFile", context);
    const sql = (await fs.readFile(filename)).toString();
    return new Promise((resolve, reject) => {
      database.exec(sql, (error, res) => {
        span.end();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static querySQL(context: Span, sql: string, params = []): Promise<any[]> {
    const span = StandardTracerStartSpan("SqlDbutils_querySQL", context);
    return new Promise((resolve, reject) => {
      database.all(sql, params, (error, rows) => {
        span.end();
        if (error) {
          reject(error);
        } else {
          resolve(rows);
        }
      });
    });
  }
}
