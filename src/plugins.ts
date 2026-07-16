import type {
  ActionDefinition,
  ContentRecord,
  ContentSummary,
  PluginDefinition,
  PluginServiceDefinition,
} from "./index.ts";
import type { Database } from "bun:sqlite";
import type { Logger } from "./logger.ts";
import { createSilentLogger } from "./silent-logger.ts";

export const RESERVED_ADMIN_SEGMENTS = Object.freeze([
  "login",
  "logout",
  "action",
  "assets",
] as const);

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export interface CompiledAction extends ActionDefinition {
  readonly name: string;
  readonly access: "public" | "admin";
  readonly ownerPluginId: string | null;
}

export interface PluginRuntime {
  readonly services: Readonly<Record<string, PluginServiceDefinition>>;
  /** Owning plugin id per service name; omitted when the plugin has no id. */
  readonly serviceOwners: Readonly<Record<string, string>>;
  readonly actions: Readonly<Record<string, CompiledAction>>;
  readonly adminActions: Readonly<
    Record<string, Readonly<Record<string, CompiledAction>>>
  >;
}

export class PluginInputError extends Error {}
export class PluginNotFoundError extends Error {}

export function buildPluginRuntime(
  plugins: readonly PluginDefinition[],
): PluginRuntime {
  const services: Record<string, PluginServiceDefinition> = Object.create(null);
  const serviceOwners: Record<string, string> = Object.create(null);
  const actions: Record<string, CompiledAction> = Object.create(null);
  const adminActions: Record<
    string,
    Record<string, CompiledAction>
  > = Object.create(null);

  for (const plugin of plugins) {
    validatePluginAdminRequirements(plugin);

    for (const [name, service] of Object.entries(plugin.services ?? {})) {
      if (services[name]) throw new Error(`Duplicate plugin service: ${name}`);
      services[name] = service;
      if (plugin.id) {
        serviceOwners[name] = plugin.id;
      }
    }

    for (const [name, action] of Object.entries(plugin.actions ?? {})) {
      const access = action.access ?? "public";
      if (!plugin.services?.[action.service]) {
        throw new Error(
          `Action ${name} references unknown service ${action.service}`,
        );
      }

      if (access === "admin") {
        const pluginId = plugin.id!;
        if (!PLUGIN_ID_PATTERN.test(name)) {
          throw new Error(
            `Admin Action name must match ${PLUGIN_ID_PATTERN}: ${name}`,
          );
        }
        if (!adminActions[pluginId]) {
          adminActions[pluginId] = Object.create(null) as Record<
            string,
            CompiledAction
          >;
        }
        if (adminActions[pluginId][name]) {
          throw new Error(
            `Duplicate admin Action: ${pluginId}/${name}`,
          );
        }
        adminActions[pluginId][name] = Object.freeze({
          ...action,
          name,
          access: "admin" as const,
          ownerPluginId: pluginId,
        });
        continue;
      }

      if (actions[name]) throw new Error(`Duplicate Action: ${name}`);
      actions[name] = Object.freeze({
        ...action,
        name,
        access: "public" as const,
        ownerPluginId: plugin.id ?? null,
      });
    }

    if (plugin.adminPage?.dataService) {
      const service = plugin.services?.[plugin.adminPage.dataService];
      if (!service) {
        throw new Error(
          `Plugin ${plugin.id} adminPage.dataService references unknown service ${plugin.adminPage.dataService}`,
        );
      }
      try {
        service.input.parse({});
      } catch {
        throw new Error(
          `Plugin ${plugin.id} adminPage.dataService ${plugin.adminPage.dataService} input schema must accept {}`,
        );
      }
    }
  }

  const frozenAdmin: Record<string, Readonly<Record<string, CompiledAction>>> =
    Object.create(null);
  for (const [pluginId, byName] of Object.entries(adminActions)) {
    frozenAdmin[pluginId] = Object.freeze(byName);
  }

  return Object.freeze({
    services: Object.freeze(services),
    serviceOwners: Object.freeze(serviceOwners),
    actions: Object.freeze(actions),
    adminActions: Object.freeze(frozenAdmin),
  });
}

function validatePluginAdminRequirements(plugin: PluginDefinition): void {
  const hasAdminPage = plugin.adminPage !== undefined;
  const hasAdminAction = Object.values(plugin.actions ?? {}).some(
    (action) => (action.access ?? "public") === "admin",
  );
  if (!hasAdminPage && !hasAdminAction) return;

  if (!plugin.id) {
    throw new Error(
      "Plugins that declare adminPage or admin Actions must have an explicit id",
    );
  }
  if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
    throw new Error(
      `Plugin ID must match ${PLUGIN_ID_PATTERN}: ${plugin.id}`,
    );
  }
  if (
    (RESERVED_ADMIN_SEGMENTS as readonly string[]).includes(plugin.id)
  ) {
    throw new Error(
      `Plugin ID ${plugin.id} is reserved for admin core routes`,
    );
  }
}

export function toContentSummary(
  record: ContentRecord,
): ContentSummary {
  return Object.freeze({
    id: record.id,
    created: record.created,
    sourcePath: record.sourcePath,
    url: record.url,
    attributes: Object.freeze({ ...record.attributes }),
  });
}

export async function callPluginService(
  runtime: PluginRuntime,
  name: string,
  input: unknown,
  database?: Database,
  contentLookup: ContentLookup = emptyContentLookup,
  signal: AbortSignal = new AbortController().signal,
  logger: Logger = createSilentLogger(),
): Promise<unknown> {
  const service = runtime.services[name];
  if (!service) throw new Error(`Unknown plugin service: ${name}`);
  let parsedInput: unknown;
  try {
    parsedInput = service.input.parse(input);
  } catch {
    throw new PluginInputError(`Invalid input for plugin service ${name}`);
  }
  const ownerPluginId = runtime.serviceOwners[name];
  const log =
    ownerPluginId === undefined
      ? logger
      : logger.child({ pluginId: ownerPluginId });
  const output = await service.handler(parsedInput, {
    signal,
    log,
    get database() {
      if (!database) {
        throw new Error(`Plugin service ${name} requires SQLite storage`);
      }
      return database;
    },
    content: Object.freeze({
      exists(contentId: string) {
        return contentLookup.exists(contentId);
      },
      get(contentId: string) {
        return contentLookup.get(contentId);
      },
    }),
  });
  return service.output.parse(output);
}

export interface ContentLookup {
  exists(contentId: string): boolean;
  get(contentId: string): ContentSummary | undefined;
}

export function createContentLookup(
  byId: ReadonlyMap<string, ContentRecord>,
): ContentLookup {
  return Object.freeze({
    exists(contentId: string) {
      return byId.has(contentId);
    },
    get(contentId: string) {
      const record = byId.get(contentId);
      return record ? toContentSummary(record) : undefined;
    },
  });
}

const emptyContentLookup: ContentLookup = Object.freeze({
  exists() {
    return false;
  },
  get() {
    return undefined;
  },
});
