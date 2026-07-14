import { z } from "zod";
import type {
  PluginDefinition,
  ValueSchema,
  SiteDefinition,
  ThemeDefinition,
} from "./index.ts";
import type { RuntimeInfo } from "./runtime-info.ts";

const positiveInteger = z.number().int().positive();

const extensionReferenceSchema = z.union([
  z.string().min(1),
  z
    .object({
      use: z.string().min(1),
      config: z.unknown().optional(),
    })
    .strict(),
]);

const siteDefinitionSchema = z
  .object({
    theme: extensionReferenceSchema,
    plugins: z.array(extensionReferenceSchema).optional(),
    reload: z
      .object({
        timeoutMs: positiveInteger.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const schemaType = z.enum([
  "string",
  "string?",
  "string[]",
  "string[]?",
  "boolean",
  "boolean?",
  "number",
  "number?",
]);

const whereCondition = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ not: z.unknown() }).strict(),
  z.object({ contains: z.unknown() }).strict(),
  z.object({ exists: z.boolean() }).strict(),
]);

const collectionDefinition = z
  .object({
    from: z.string().min(1),
    schema: z.record(z.string(), schemaType),
    where: z.record(z.string(), whereCondition).optional(),
    orderBy: z
      .array(
        z
          .object({
            field: z.string().min(1),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const itemBinding = z
  .object({
    collection: z.string().min(1),
    match: z.string().min(1),
  })
  .strict();

const listBinding = z
  .object({
    collection: z.string().min(1),
    limit: positiveInteger.optional(),
    paginate: positiveInteger.optional(),
  })
  .strict();

const serviceBinding = z
  .object({
    service: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

const themeDefinitionSchema = z
  .object({
    collections: z.record(z.string(), collectionDefinition),
    routes: z.array(
      z
        .object({
          path: z.string().min(1),
          page: z
            .object({
              name: z.string().min(1),
              data: z.record(
                z.string(),
                z.union([itemBinding, listBinding, serviceBinding]),
              ),
            })
            .strict(),
          canonical: z.boolean(),
        })
        .strict(),
    ),
    document: z.string().min(1).optional(),
    styles: z.string().min(1).optional(),
  })
  .strict();

const valueSchema = z.custom<ValueSchema>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function",
  "expected an object with a parse function",
);

const pluginServiceDefinition = z
  .object({
    input: valueSchema,
    output: valueSchema,
    handler: z.custom<(...args: any[]) => unknown>(
      (value) => typeof value === "function",
      "expected a handler function",
    ),
  })
  .strict();

const actionDefinition = z
  .object({
    service: z.string().min(1),
    bodyLimitBytes: positiveInteger.max(65_536).optional(),
    rateLimit: z
      .object({
        limit: positiveInteger,
        windowMs: positiveInteger,
      })
      .strict()
      .optional(),
    timeoutMs: positiveInteger.optional(),
    credentials: z.literal("cookie").optional(),
  })
  .strict();

const pluginDefinitionSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    schemaVersion: z.number().int().nonnegative().optional(),
    migrations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            schemaVersion: z.number().int().positive(),
            sql: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    services: z.record(z.string(), pluginServiceDefinition).optional(),
    actions: z.record(z.string(), actionDefinition).optional(),
    markdown: z
      .object({
        remarkPlugins: z.array(z.unknown()).optional(),
        rehypePlugins: z.array(z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const runtimeInfoSchema = z
  .object({
    pid: positiveInteger,
    adminPort: positiveInteger.max(65_535),
    token: z.string().min(1),
  })
  .strict();

export function parseSiteDefinition(value: unknown): SiteDefinition {
  return parseDefinition(siteDefinitionSchema, value, "site config");
}

export function parseConfiguredValue<Value>(
  schema: ValueSchema<Value>,
  value: unknown,
  label: string,
): Value {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
      throw new Error(
        `${label}${path}: ${issue?.message ?? "invalid configuration"}`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

export function parseThemeDefinition(
  value: unknown,
  label = "theme",
): ThemeDefinition {
  return parseDefinition(themeDefinitionSchema, value, label);
}

export function parsePluginDefinition(
  value: unknown,
  label = "plugin",
): PluginDefinition {
  return parseDefinition(pluginDefinitionSchema, value, label) as PluginDefinition;
}

export function parseRuntimeInfo(value: unknown): RuntimeInfo {
  return parseDefinition(runtimeInfoSchema, value, "runtime info");
}

function parseDefinition<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
  throw new Error(`${label}${path}: ${issue?.message ?? "invalid definition"}`);
}
