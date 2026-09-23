import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import {
  assertStorageConfiguration,
  cloudStorage,
  dataDir,
  requiredEnv,
} from "./environment";

type Value = string | number | null;
type Row = Record<string, string | number | null>;
type Result = { rows: Row[]; changes: number };
type Connection = { execute: (sql: string, args: Value[]) => Promise<Result> };
type State = {
  local?: DatabaseSync;
  remote?: ReturnType<typeof postgres>;
  initialized?: Promise<void>;
  context: AsyncLocalStorage<Connection>;
  tail: Promise<unknown>;
};
const globalStore = globalThis as unknown as { hubSql?: State };
const state = (globalStore.hubSql ??= {
  context: new AsyncLocalStorage(),
  tail: Promise.resolve(),
});

// Only parameters are translated. SQL string literals (including literal '?') stay intact.
export function postgresParameters(sql: string) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|\?/g, (token) =>
    token === "?" ? `$${++index}` : token,
  );
}
const camelColumns = [
  "projectId",
  "parentId",
  "createdAt",
  "updatedAt",
  "nodeCount",
  "nodeId",
  "maxAttempts",
  "nextRunAt",
  "leaseUntil",
  "leaseToken",
];
function normalize(row: Record<string, unknown>): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camelColumns.find((name) => name.toLowerCase() === key) || key,
      value,
    ]),
  ) as Row;
}

async function localConnection(): Promise<Connection> {
  if (!state.local) {
    const { DatabaseSync } = await import("node:sqlite");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    state.local = new DatabaseSync(path.join(dataDir, "hub.sqlite"));
    state.local.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
  }
  return {
    execute: async (sql, args) => {
      const statement = state.local!.prepare(sql);
      if (statement.columns().length)
        return { rows: statement.all(...args) as Row[], changes: 0 };
      const result = statement.run(...args);
      return { rows: [], changes: Number(result.changes) };
    },
  };
}
function remoteClient() {
  return (state.remote ??= postgres(requiredEnv("DATABASE_URL"), {
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: "require",
    types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } },
  }));
}
function remoteConnection(
  client: Pick<ReturnType<typeof postgres>, "unsafe">,
): Connection {
  return {
    execute: async (sql, args) => {
      const result = await client.unsafe(postgresParameters(sql), args);
      return { rows: result.map(normalize), changes: result.count };
    },
  };
}
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

export const schema = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL, projectId TEXT REFERENCES projects(id) ON DELETE SET NULL, parentId TEXT REFERENCES nodes(id) ON DELETE SET NULL, status TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS nodes_project ON nodes(projectId);
CREATE INDEX IF NOT EXISTS nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS nodes_created ON nodes(createdAt DESC);
CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parentId);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, nodeId TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE, mode TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, maxAttempts INTEGER NOT NULL DEFAULT 3, nextRunAt BIGINT NOT NULL, leaseUntil BIGINT, leaseToken TEXT, error TEXT, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_jobs_due ON ai_jobs(status,nextRunAt);
`;

async function initialize() {
  assertStorageConfiguration();
  if (!state.initialized)
    state.initialized = (async () => {
      if (cloudStorage()) {
        // Migrations are explicit. Runtime credentials do not need DDL permissions.
        await remoteClient().unsafe(
          "SELECT 1 FROM inspiration_hub.meta LIMIT 1",
        );
      } else {
        await localConnection();
        state.local!.exec(schema);
      }
    })().catch((error) => {
      state.initialized = undefined;
      throw error;
    });
  await state.initialized;
}

export async function transaction<T>(work: () => T | Promise<T>): Promise<T> {
  if (state.context.getStore()) return work();
  await initialize();
  if (cloudStorage()) {
    return (await remoteClient().begin(async (client) => {
      await client.unsafe(
        "SET LOCAL search_path TO inspiration_hub, pg_catalog",
      );
      // Personal workspace: serialize mutations across all serverless instances.
      await client.unsafe("SELECT pg_advisory_xact_lock(731904821)");
      return state.context.run(remoteConnection(client), work);
    })) as T;
  }
  return exclusive(async () => {
    const connection = await localConnection();
    state.local!.exec("BEGIN IMMEDIATE");
    try {
      const result = await state.context.run(connection, work);
      state.local!.exec("COMMIT");
      return result;
    } catch (error) {
      state.local!.exec("ROLLBACK");
      throw error;
    }
  });
}
async function execute(sql: string, args: Value[]) {
  const connection = state.context.getStore();
  if (connection) return connection.execute(sql, args);
  // All queries use the same transaction-scoped schema and lock discipline.
  return transaction(() => state.context.getStore()!.execute(sql, args));
}
export const db = {
  prepare(sql: string) {
    return {
      all: async (...args: Value[]) => (await execute(sql, args)).rows,
      get: async (...args: Value[]) => (await execute(sql, args)).rows[0],
      run: async (...args: Value[]) => ({
        changes: (await execute(sql, args)).changes,
      }),
    };
  },
  async exec(sql: string) {
    await initialize();
    if (cloudStorage()) throw new Error("云端请使用 migrations 执行 DDL");
    return exclusive(async () => {
      state.local!.exec(sql);
    });
  },
  async close() {
    await state.tail;
    state.local?.close();
    await state.remote?.end();
    state.local = undefined;
    state.remote = undefined;
    state.initialized = undefined;
  },
};

export const dialect = (sqlite: string, pg: string) =>
  cloudStorage() ? pg : sqlite;
