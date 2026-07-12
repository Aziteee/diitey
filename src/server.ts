import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { h, type ComponentType } from "preact";
import renderToString from "preact-render-to-string";
import { buildContentRecord } from "./content.ts";
import type {
  ContentRecord,
  SiteDefinition,
  ThemeDefinition,
} from "./index.ts";

interface StartOptions {
  root: string;
  port: number;
}

interface PublishedPage {
  path: string;
  title: string;
  body: string;
}

export async function startSite(options: StartOptions): Promise<Bun.Server<undefined>> {
  const page = await buildPublishedPage(options.root);

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (normalizePath(url.pathname) !== page.path) {
        return new Response("Not Found", { status: 404 });
      }

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title></head><body>${page.body}</body></html>`;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
}

async function buildPublishedPage(root: string): Promise<PublishedPage> {
  const configPath = resolve(root, "site.config.ts");
  const config = await importDefault<SiteDefinition>(configPath, "site config");
  const themePath = resolve(root, config.theme);
  const theme = await importDefault<ThemeDefinition>(themePath, "theme");
  const route = theme.routes[0];
  if (!route) {
    throw new Error("Theme must declare one route");
  }

  const binding = route.page.data.item;
  const selectedCollection = theme.collections[binding.collection];
  if (!selectedCollection) {
    throw new Error(`Unknown collection: ${binding.collection}`);
  }
  if (selectedCollection.from !== binding.match) {
    throw new Error("The route item must match the collection's content file");
  }

  const sourcePath = binding.match.replaceAll("\\", "/");
  const record = await buildContentRecord(resolve(root, "content", sourcePath), sourcePath);
  validateThemeSchema(record, selectedCollection.schema);

  const pagePath = resolve(themePath, "..", "pages", `${route.page.name}.tsx`);
  const Page = await importDefault<ComponentType<{ item: ContentRecord }>>(
    pagePath,
    `theme page ${route.page.name}`,
  );
  const title = record.attributes.title;

  return {
    path: normalizePath(route.path),
    title: typeof title === "string" ? title : "Diitey",
    body: renderToString(h(Page, { item: record })),
  };
}

async function importDefault<T>(filePath: string, label: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as { default?: T };
  if (!module.default) {
    throw new Error(`Missing default export from ${label}`);
  }
  return module.default;
}

function validateThemeSchema(
  record: ContentRecord,
  schema: Readonly<Record<string, "string">>,
): void {
  for (const [field, type] of Object.entries(schema)) {
    if (type === "string" && typeof record.attributes[field] !== "string") {
      throw new Error(`${record.sourcePath}: ${field} must be a string`);
    }
  }
}

function normalizePath(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
