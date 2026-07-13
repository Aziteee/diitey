import type {
  ActionDefinition,
  PluginDefinition,
  PluginServiceDefinition,
  ServiceBinding,
} from "./index.ts";
import type { Database } from "bun:sqlite";

export interface PluginRuntime {
  readonly services: Readonly<Record<string, PluginServiceDefinition>>;
  readonly actions: Readonly<Record<string, ActionDefinition>>;
}

export class PluginInputError extends Error {}
export class PluginNotFoundError extends Error {}

export function buildPluginRuntime(
  plugins: readonly PluginDefinition[],
): PluginRuntime {
  const services: Record<string, PluginServiceDefinition> = Object.create(null);
  const actions: Record<string, ActionDefinition> = Object.create(null);
  for (const plugin of plugins) {
    for (const [name, service] of Object.entries(plugin.services ?? {})) {
      if (services[name]) throw new Error(`Duplicate plugin service: ${name}`);
      services[name] = service;
    }
    for (const [name, action] of Object.entries(plugin.actions ?? {})) {
      if (actions[name]) throw new Error(`Duplicate Action: ${name}`);
      if (!plugin.services?.[action.service]) {
        throw new Error(`Action ${name} references unknown service ${action.service}`);
      }
      actions[name] = action;
    }
  }
  return Object.freeze({
    services: Object.freeze(services),
    actions: Object.freeze(actions),
  });
}

export async function callPluginService(
  runtime: PluginRuntime,
  name: string,
  input: unknown,
  database?: Database,
  contentIds: ReadonlySet<string> = new Set(),
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const service = runtime.services[name];
  if (!service) throw new Error(`Unknown plugin service: ${name}`);
  let parsedInput: unknown;
  try {
    parsedInput = service.input.parse(input);
  } catch {
    throw new PluginInputError(`Invalid input for plugin service ${name}`);
  }
  const output = await service.handler(parsedInput, {
    signal,
    get database() {
      if (!database) {
        throw new Error(`Plugin service ${name} requires SQLite storage`);
      }
      return database;
    },
    content: Object.freeze({
      exists(contentId: string) {
        return contentIds.has(contentId);
      },
    }),
  });
  return service.output.parse(output);
}

export function buildServiceInput(
  binding: ServiceBinding,
  pageData: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(binding.input).map(([name, value]) => [
      name,
      isDataReference(value) ? readDataPath(pageData, value.from) : value,
    ]),
  );
}

function isDataReference(value: unknown): value is { readonly from: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { from?: unknown }).from === "string"
  );
}

function readDataPath(
  data: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  let value: unknown = data;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null || !(segment in value)) {
      throw new Error(`Service input reference ${path} does not exist`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
