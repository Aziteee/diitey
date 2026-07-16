import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { PluginDefinition } from "./index.ts";
import type { Logger } from "./logger.ts";
import { createSilentLogger } from "./silent-logger.ts";

interface MigrationRow {
  checksum: string;
}

interface MigrationHistoryRow {
  migration_id: string;
}

interface SchemaRow {
  schema_version: number;
}

export async function preparePluginDatabase(
  root: string,
  plugins: readonly PluginDefinition[],
  logger: Logger = createSilentLogger(),
): Promise<Database> {
  await mkdir(resolve(root, "data"), { recursive: true });
  const database = new Database(resolve(root, "data", "site.sqlite"), {
    create: true,
  });
  try {
    applyPendingPluginMigrations(database, plugins, logger);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function applyPendingPluginMigrations(
  database: Database,
  plugins: readonly PluginDefinition[],
  logger: Logger,
): void {
  const databasePlugins = plugins.filter(
    (plugin) => plugin.schemaVersion !== undefined,
  );
  if (databasePlugins.length === 0) return;

  logger.info("plugin migrations started", {
    pluginCount: databasePlugins.length,
  });
  try {
    const migrate = database.transaction(() => {
      ensureMetadata(database);
      for (const plugin of databasePlugins) {
        validatePluginIdentity(plugin);
        const pluginId = plugin.id!;
        const expected = plugin.schemaVersion!;
        let current = readSchemaVersion(database, pluginId);
        if (current > expected) {
          throw new Error(
            `Plugin ${pluginId} requires schema ${expected}, database is ${current}`,
          );
        }

        const migrations = [...(plugin.migrations ?? [])].sort(
          (left, right) => left.schemaVersion - right.schemaVersion,
        );
        validateMigrations(plugin, migrations);
        const declaredMigrationIds = new Set(
          migrations.map((migration) => migration.id),
        );
        const history = database
          .query<MigrationHistoryRow, [string]>(
            "SELECT migration_id FROM diitey_plugin_migrations WHERE plugin_id = ?",
          )
          .all(pluginId);
        for (const applied of history) {
          if (!declaredMigrationIds.has(applied.migration_id)) {
            throw new Error(
              `Applied migration missing from plugin: ${pluginId}/${applied.migration_id}`,
            );
          }
        }
        for (const migration of migrations) {
          const checksum = checksumOf(migration.sql);
          const existing = database
            .query<MigrationRow, [string, string]>(
              "SELECT checksum FROM diitey_plugin_migrations WHERE plugin_id = ? AND migration_id = ?",
            )
            .get(pluginId, migration.id);
          if (existing) {
            if (existing.checksum !== checksum) {
              throw new Error(
                `Migration checksum changed: ${pluginId}/${migration.id}`,
              );
            }
            continue;
          }

          if (migration.schemaVersion <= current) {
            throw new Error(
              `Missing migration history: ${pluginId}/${migration.id}`,
            );
          }
          database.exec(migration.sql);
          database
            .query(
              "INSERT INTO diitey_plugin_migrations (plugin_id, migration_id, schema_version, checksum, executed_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(
              pluginId,
              migration.id,
              migration.schemaVersion,
              checksum,
              new Date().toISOString(),
            );
          current = migration.schemaVersion;
        }

        if (current !== expected) {
          throw new Error(
            `Plugin ${pluginId} requires schema ${expected}, database is ${current}`,
          );
        }
        database
          .query(
            "INSERT INTO diitey_plugin_schema (plugin_id, schema_version, plugin_version) VALUES (?, ?, ?) ON CONFLICT(plugin_id) DO UPDATE SET schema_version = excluded.schema_version, plugin_version = excluded.plugin_version",
          )
          .run(pluginId, expected, plugin.version!);
      }
    });
    migrate();
    logger.info("plugin migrations succeeded", {
      pluginCount: databasePlugins.length,
    });
  } catch (error) {
    logger.error("plugin migrations failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
