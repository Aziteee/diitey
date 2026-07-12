import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import type { PluginDefinition, SiteDefinition } from "./index.ts";

interface MigrationRow {
  checksum: string;
}

interface SchemaRow {
  schema_version: number;
}

export async function loadConfiguredPlugins(
  root: string,
): Promise<readonly PluginDefinition[]> {
  const config = await importDefault<SiteDefinition>(
    resolve(root, "site.config.ts"),
    "site config",
  );
  return Promise.all(
    (config.plugins ?? []).map((pluginPath) =>
      importDefault<PluginDefinition>(
        resolve(root, pluginPath),
        `plugin ${pluginPath}`,
      ),
    ),
  );
}

export async function openPluginDatabase(
  root: string,
  plugins: readonly PluginDefinition[],
): Promise<Database> {
  await mkdir(resolve(root, "data"), { recursive: true });
  const database = new Database(resolve(root, "data", "site.sqlite"), {
    create: true,
  });
  try {
    validatePluginSchemas(database, plugins);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function runPluginMigration(
  root: string,
  operation: "install" | "upgrade",
  requestedId: string,
): Promise<{
  readonly status: "succeeded";
  readonly pluginId: string;
  readonly schemaVersion: number;
  readonly applied: readonly string[];
}> {
  const plugins = await loadConfiguredPlugins(root);
  const plugin = plugins.find((candidate) => candidate.id === requestedId);
  if (!plugin) throw new Error(`Configured plugin not found: ${requestedId}`);
  validatePluginIdentity(plugin);
  await mkdir(resolve(root, "data"), { recursive: true });
  const database = new Database(resolve(root, "data", "site.sqlite"), {
    create: true,
  });
  try {
    ensureMetadata(database);
    const migrations = [...(plugin.migrations ?? [])].sort(
      (left, right) => left.schemaVersion - right.schemaVersion,
    );
    validateMigrations(plugin, migrations);
    const applied: string[] = [];
    for (const migration of migrations) {
      const checksum = checksumOf(migration.sql);
      const existing = database
        .query<MigrationRow, [string, string]>(
          "SELECT checksum FROM diitey_plugin_migrations WHERE plugin_id = ? AND migration_id = ?",
        )
        .get(requestedId, migration.id);
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Migration checksum changed: ${requestedId}/${migration.id}`,
          );
        }
        continue;
      }
      database.transaction(() => {
        database.exec(migration.sql);
        database
          .query(
            "INSERT INTO diitey_plugin_migrations (plugin_id, migration_id, schema_version, checksum, executed_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            requestedId,
            migration.id,
            migration.schemaVersion,
            checksum,
            new Date().toISOString(),
          );
        database
          .query(
            "INSERT INTO diitey_plugin_schema (plugin_id, schema_version, plugin_version) VALUES (?, ?, ?) ON CONFLICT(plugin_id) DO UPDATE SET schema_version = excluded.schema_version, plugin_version = excluded.plugin_version",
          )
          .run(requestedId, migration.schemaVersion, plugin.version!);
      })();
      applied.push(migration.id);
    }
    const schemaVersion = readSchemaVersion(database, requestedId);
    if (schemaVersion !== plugin.schemaVersion) {
      throw new Error(
        `Plugin ${requestedId} requires schema ${plugin.schemaVersion}, database is ${schemaVersion}`,
      );
    }
    return Object.freeze({
      status: "succeeded",
      pluginId: requestedId,
      schemaVersion,
      applied: Object.freeze(applied),
    });
  } finally {
    database.close();
  }
}

function validatePluginSchemas(
  database: Database,
  plugins: readonly PluginDefinition[],
): void {
  for (const plugin of plugins) {
    if (plugin.schemaVersion === undefined) continue;
    const expected = plugin.schemaVersion;
    validatePluginIdentity(plugin);
    const current = hasMetadata(database)
      ? readSchemaVersion(database, plugin.id!)
      : 0;
    if (current !== expected) {
      throw new Error(
        `Plugin ${plugin.id} requires schema ${expected}, database is ${current}; run diitey plugin upgrade ${plugin.id}`,
      );
    }
  }
}

function validatePluginIdentity(plugin: PluginDefinition): void {
  if (!plugin.id || !plugin.version || !Number.isInteger(plugin.schemaVersion)) {
    throw new Error("Database plugins must declare id, version, and schemaVersion");
  }
}

function validateMigrations(
  plugin: PluginDefinition,
  migrations: readonly NonNullable<PluginDefinition["migrations"]>[number][],
): void {
  const ids = new Set<string>();
  let previousVersion = 0;
  for (const migration of migrations) {
    if (ids.has(migration.id)) {
      throw new Error(`Duplicate migration ID: ${plugin.id}/${migration.id}`);
    }
    ids.add(migration.id);
    if (
      !Number.isInteger(migration.schemaVersion) ||
      migration.schemaVersion <= previousVersion
    ) {
      throw new Error(`Plugin ${plugin.id} migrations must have increasing schema versions`);
    }
    previousVersion = migration.schemaVersion;
  }
  if (previousVersion !== plugin.schemaVersion) {
    throw new Error(
      `Plugin ${plugin.id} migrations end at schema ${previousVersion}, expected ${plugin.schemaVersion}`,
    );
  }
}

function ensureMetadata(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS diitey_plugin_migrations (
      plugin_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      executed_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, migration_id)
    );
    CREATE TABLE IF NOT EXISTS diitey_plugin_schema (
      plugin_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      plugin_version TEXT NOT NULL
    );
  `);
}

function hasMetadata(database: Database): boolean {
  return database
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diitey_plugin_schema'",
    )
    .get() !== null;
}

function readSchemaVersion(database: Database, pluginId: string): number {
  return (
    database
      .query<SchemaRow, [string]>(
        "SELECT schema_version FROM diitey_plugin_schema WHERE plugin_id = ?",
      )
      .get(pluginId)?.schema_version ?? 0
  );
}

function checksumOf(sql: string): string {
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
}

async function importDefault<T>(filePath: string, label: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as { default?: T };
  if (!module.default) throw new Error(`Missing default export from ${label}`);
  return module.default;
}
