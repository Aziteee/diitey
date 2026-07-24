import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import remarkDirective from "remark-directive";
import { definePlugin } from "diitey";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import { z } from "zod";

const linkCardPluginConfig = z
  .object({
    /** Absolute path or path relative to the plugin entry directory. */
    cachePath: z.string().trim().min(1).optional(),
    fetchTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(60_000)
      .optional()
      .default(8_000),
    maxRedirects: z.number().int().min(0).max(10).optional().default(5),
    maxBodyBytes: z
      .number()
      .int()
      .positive()
      .max(5_000_000)
      .optional()
      .default(512_000),
    userAgent: z
      .string()
      .trim()
      .min(1)
      .optional()
      .default("DiiteyLinkCard/1.0"),
    githubToken: z.string().optional().default(""),
  })
  .strict()
  .default({
    fetchTimeoutMs: 8_000,
    maxRedirects: 5,
    maxBodyBytes: 512_000,
    userAgent: "DiiteyLinkCard/1.0",
    githubToken: "",
  });

export type LinkCardPluginConfig = z.infer<typeof linkCardPluginConfig>;

export interface LinkCardMetadata {
  readonly url: string;
  readonly title: string;
  readonly description: string | null;
  readonly image: string | null;
  readonly siteName: string | null;
  readonly provider: string | null;
  readonly extras: Readonly<Record<string, string>>;
  readonly degraded: boolean;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface LinkCardDependencies {
  readonly fetch?: FetchLike;
  readonly cachePath?: string;
  readonly now?: () => number;
}

interface DirectiveNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  children?: unknown[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  value?: string;
}

interface ResolveInput {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly siteName?: string;
  readonly provider?: string;
  readonly refresh?: boolean;
}

type ProviderId = "github" | "generic";

const cachePayloadSchema = z
  .object({
    url: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    image: z.string().nullable(),
    siteName: z.string().nullable(),
    provider: z.string().nullable(),
    extras: z.record(z.string(), z.string()),
    degraded: z.boolean(),
  })
  .strict();

export function createLinkCardDefinition(
  config: LinkCardPluginConfig,
  dependencies: LinkCardDependencies = {},
) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const cachePath =
    dependencies.cachePath ??
    resolveCachePath(config.cachePath, import.meta.dir);
  const database = openCacheDatabase(cachePath);
  const inFlight = new Map<string, Promise<LinkCardMetadata>>();

  const resolveCard = async (input: ResolveInput): Promise<LinkCardMetadata> => {
    const normalized = normalizeUrl(input.url);
    if (!normalized) {
      return degradedCard(input.url, input);
    }

    const cacheKey = normalized;
    if (!input.refresh) {
      const cached = readCache(database, cacheKey);
      if (cached) {
        return applyOverrides(cached, input);
      }
    }

    const pending = coalesce(inFlight, cacheKey, async () => {
      if (!input.refresh) {
        const rechecked = readCache(database, cacheKey);
        if (rechecked) return rechecked;
      }

      const stale = readCache(database, cacheKey, { allowAny: true });
      try {
        const resolved = await fetchMetadata(normalized, input.provider, {
          fetchImpl,
          config,
        });
        writeCache(database, cacheKey, resolved);
        return resolved;
      } catch {
        if (stale) return { ...stale, degraded: false };
        return degradedCard(normalized, {});
      }
    });

    return applyOverrides(await pending, input);
  };

  return {
    id: "link-card",
    name: "Link card",
    version: "1.0.0",
    markdown: {
      remarkPlugins: [
        remarkDirective,
        () => remarkLinkCard(resolveCard),
      ],
    },
  };
}

export default definePlugin({
  config: linkCardPluginConfig,
  setup(config) {
    return createLinkCardDefinition(config);
  },
});

export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "[::]" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return false;
  }
  if (isPrivateOrReservedHost(host)) {
    return false;
  }
  return true;
}

export function matchGithubRepo(
  raw: string,
): { owner: string; repo: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  let repo = parts[1]!;
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!owner || !repo) return null;
  if (parts.length > 2) {
    // Allow bare repo URLs only (no /issues, /tree, …).
    return null;
  }
  return { owner, repo };
}

export function parseOpenGraph(html: string, pageUrl: string): LinkCardMetadata {
  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    titleTag(html) ??
    hostnameOf(pageUrl);
  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description") ??
    metaContent(html, "description");
  const imageRaw =
    metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  const siteName =
    metaContent(html, "og:site_name") ?? hostnameOf(pageUrl);
  const image = imageRaw ? absolutizeUrl(imageRaw, pageUrl) : null;

  return {
    url: pageUrl,
    title: decodeEntities(title).trim() || hostnameOf(pageUrl),
    description: description ? decodeEntities(description).trim() || null : null,
    image,
    siteName: siteName ? decodeEntities(siteName).trim() || null : null,
    provider: null,
    extras: {},
    degraded: false,
  };
}

export function renderLinkCardHtml(meta: LinkCardMetadata): string {
  const classes = ["link-card"];
  if (meta.degraded) classes.push("link-card--degraded");
  if (meta.provider) classes.push(`link-card--${escapeAttr(meta.provider)}`);

  const extrasBlock = renderExtras(meta.extras);

  const media = meta.image
    ? `<span class="link-card__media"><img class="link-card__image" src="${escapeAttr(meta.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`
    : "";

  const description = meta.description
    ? `<span class="link-card__description">${escapeHtml(meta.description)}</span>`
    : "";

  const site = meta.siteName
    ? `<span class="link-card__site">${escapeHtml(meta.siteName)}</span>`
    : "";

  return (
    `<a class="${classes.join(" ")}" href="${escapeAttr(meta.url)}" ` +
    `data-link-card="true"` +
    (meta.provider ? ` data-provider="${escapeAttr(meta.provider)}"` : "") +
    (meta.degraded ? ` data-degraded="true"` : "") +
    ` target="_blank" rel="noopener noreferrer">` +
    `<span class="link-card__body">` +
    site +
    `<span class="link-card__title">${escapeHtml(meta.title)}</span>` +
    description +
    extrasBlock +
    `</span>` +
    media +
    `</a>`
  );
}

function renderExtras(
  extras: Readonly<Record<string, string>>,
): string {
  const preferred = ["language", "stars", "forks"] as const;
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const key of preferred) {
    const value = extras[key]?.trim();
    if (!value) continue;
    seen.add(key);
    parts.push(renderExtra(key, value));
  }
  for (const [key, value] of Object.entries(extras)) {
    if (seen.has(key) || value.trim() === "") continue;
    parts.push(renderExtra(key, value));
  }
  if (parts.length === 0) return "";
  return `<span class="link-card__extras">${parts.join("")}</span>`;
}

function renderExtra(key: string, value: string): string {
  if (key === "stars") {
    return (
      `<span class="link-card__extra link-card__extra--stars" data-key="stars">` +
      `${ICON_STAR}<span class="link-card__extra-value">${escapeHtml(value)}</span>` +
      `</span>`
    );
  }
  if (key === "forks") {
    return (
      `<span class="link-card__extra link-card__extra--forks" data-key="forks">` +
      `${ICON_FORK}<span class="link-card__extra-value">${escapeHtml(value)}</span>` +
      `</span>`
    );
  }
  if (key === "language") {
    const color = languageColor(value);
    return (
      `<span class="link-card__extra link-card__extra--language" data-key="language">` +
      `<span class="link-card__lang-dot" style="background:${escapeAttr(color)}" aria-hidden="true"></span>` +
      `<span class="link-card__extra-value">${escapeHtml(value)}</span>` +
      `</span>`
    );
  }
  return (
    `<span class="link-card__extra" data-key="${escapeAttr(key)}">` +
    `<span class="link-card__extra-label">${escapeHtml(key)}</span>` +
    `<span class="link-card__extra-value">${escapeHtml(value)}</span>` +
    `</span>`
  );
}

// Octicons-style 16px paths (MIT), inlined for static HTML.
const ICON_STAR =
  `<svg class="link-card__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>`;

const ICON_FORK =
  `<svg class="link-card__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`;

/** Subset of GitHub linguist colors; unknown languages fall back to neutral gray. */
const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Scala: "#c22d40",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Lua: "#000080",
  R: "#198CE7",
  Markdown: "#083fa1",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Vim: "#199f4b",
  Zig: "#ec915c",
  Nim: "#ffc200",
  OCaml: "#ef7a08",
  Julia: "#a270ba",
  Perl: "#0298c3",
  Clojure: "#db5855",
  Erlang: "#B83998",
  "Objective-C": "#438eff",
  Assembly: "#6E4C13",
  PowerShell: "#012456",
  SCSS: "#c6538c",
  Less: "#1d365d",
  Astro: "#ff5a03",
  Solid: "#2c4f7c",
  Jupyter: "#DA5B0B",
};

export function languageColor(language: string): string {
  return LANGUAGE_COLORS[language] ?? "#8b949e";
}

function remarkLinkCard(
  resolveCard: (input: ResolveInput) => Promise<LinkCardMetadata>,
) {
  return async function transform(tree: Root): Promise<void> {
    const nodes: DirectiveNode[] = [];
    visit(tree, (node) => {
      const candidate = node as DirectiveNode;
      if (
        (candidate.type === "containerDirective" ||
          candidate.type === "leafDirective") &&
        candidate.name === "link-card"
      ) {
        nodes.push(candidate);
      }
    });

    for (const node of nodes) {
      const input = parseDirectiveInput(node);
      if (!input) {
        node.type = "html";
        node.value = `<!-- link-card: missing url -->`;
        node.children = undefined;
        continue;
      }
      const meta = await resolveCard(input);
      node.type = "html";
      node.value = renderLinkCardHtml(meta);
      node.children = undefined;
      node.attributes = undefined;
      node.name = undefined;
    }
  };
}

function parseDirectiveInput(node: DirectiveNode): ResolveInput | null {
  const attrs = node.attributes ?? {};
  const url =
    readAttr(attrs, "url") ??
    readAttr(attrs, "href") ??
    extractLabelUrl(node);
  if (!url) return null;

  const refreshRaw = readAttr(attrs, "refresh");
  const refresh =
    refreshRaw === "" ||
    refreshRaw === "true" ||
    refreshRaw === "1" ||
    attrs.refresh === null;

  return {
    url,
    title: readAttr(attrs, "title") || undefined,
    description: readAttr(attrs, "description") || undefined,
    image: readAttr(attrs, "image") || undefined,
    siteName: readAttr(attrs, "siteName") || readAttr(attrs, "site") || undefined,
    provider: readAttr(attrs, "provider") || undefined,
    refresh: refresh || undefined,
  };
}

function extractLabelUrl(node: DirectiveNode): string | undefined {
  // remark-directive may put a label as the first paragraph text child.
  const children = node.children as
    | { type?: string; children?: { type?: string; value?: string }[] }[]
    | undefined;
  if (!children?.length) return undefined;
  const first = children[0];
  if (first?.type === "paragraph" && first.children?.[0]?.type === "text") {
    const value = first.children[0].value?.trim();
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

function readAttr(
  attrs: Record<string, string | null | undefined>,
  key: string,
): string | undefined {
  const value = attrs[key];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function fetchMetadata(
  url: string,
  providerOverride: string | undefined,
  options: {
    readonly fetchImpl: FetchLike;
    readonly config: LinkCardPluginConfig;
  },
): Promise<LinkCardMetadata> {
  const provider = resolveProvider(url, providerOverride);
  if (provider === "github") {
    try {
      return await fetchGithub(url, options);
    } catch {
      // fall through to generic
    }
  }
  return fetchGeneric(url, options);
}

function resolveProvider(
  url: string,
  override: string | undefined,
): ProviderId {
  const normalized = override?.trim().toLowerCase();
  if (normalized === "generic") return "generic";
  if (normalized === "github") return "github";
  if (matchGithubRepo(url)) return "github";
  return "generic";
}

async function fetchGithub(
  url: string,
  options: {
    readonly fetchImpl: FetchLike;
    readonly config: LinkCardPluginConfig;
  },
): Promise<LinkCardMetadata> {
  const match = matchGithubRepo(url);
  if (!match) throw new Error("not a github repo url");
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(match.owner)}/${encodeURIComponent(match.repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": options.config.userAgent,
  };
  if (options.config.githubToken) {
    headers.Authorization = `Bearer ${options.config.githubToken}`;
  }
  const response = await fetchPublic(apiUrl, options, { headers });
  if (!response.ok) {
    throw new Error(`github api ${response.status}`);
  }
  const data = (await response.json()) as {
    full_name?: string;
    description?: string | null;
    html_url?: string;
    homepage?: string | null;
    language?: string | null;
    stargazers_count?: number;
    forks_count?: number;
    owner?: { avatar_url?: string; login?: string };
  };
  const extras: Record<string, string> = {};
  if (typeof data.stargazers_count === "number") {
    extras.stars = String(data.stargazers_count);
  }
  if (typeof data.forks_count === "number") {
    extras.forks = String(data.forks_count);
  }
  if (data.language) extras.language = data.language;

  return {
    url: data.html_url ?? url,
    title: data.full_name ?? `${match.owner}/${match.repo}`,
    description: data.description?.trim() || null,
    image: data.owner?.avatar_url ?? null,
    siteName: "GitHub",
    provider: "github",
    extras,
    degraded: false,
  };
}

async function fetchGeneric(
  url: string,
  options: {
    readonly fetchImpl: FetchLike;
    readonly config: LinkCardPluginConfig;
  },
): Promise<LinkCardMetadata> {
  const response = await fetchPublic(url, options, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": options.config.userAgent,
    },
  });
  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType &&
    !/text\/html|application\/xhtml\+xml/i.test(contentType)
  ) {
    throw new Error("not html");
  }
  const html = await readBodyText(response, options.config.maxBodyBytes);
  return parseOpenGraph(html, response.url || url);
}

async function fetchPublic(
  url: string,
  options: {
    readonly fetchImpl: FetchLike;
    readonly config: LinkCardPluginConfig;
  },
  init: RequestInit,
  redirectCount = 0,
): Promise<Response> {
  if (!isPublicHttpUrl(url)) {
    throw new Error("url is not a public http(s) target");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.config.fetchTimeoutMs,
  );
  try {
    const response = await options.fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      if (redirectCount >= options.config.maxRedirects) {
        throw new Error("too many redirects");
      }
      const location = response.headers.get("location")!;
      const next = new URL(location, url).href;
      return fetchPublic(next, options, init, redirectCount + 1);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new Error("body too large");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (byteLength(text) > maxBytes) throw new Error("body too large");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("body too large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks));
}

function applyOverrides(
  meta: LinkCardMetadata,
  input: ResolveInput,
): LinkCardMetadata {
  return {
    ...meta,
    title: input.title?.trim() || meta.title,
    description:
      input.description !== undefined
        ? input.description.trim() || null
        : meta.description,
    image:
      input.image !== undefined ? input.image.trim() || null : meta.image,
    siteName:
      input.siteName !== undefined
        ? input.siteName.trim() || null
        : meta.siteName,
  };
}

function degradedCard(
  url: string,
  input: Pick<
    ResolveInput,
    "title" | "description" | "image" | "siteName"
  >,
): LinkCardMetadata {
  const host = hostnameOf(url) || url;
  return {
    url,
    title: input.title?.trim() || host,
    description: input.description?.trim() || null,
    image: input.image?.trim() || null,
    siteName: input.siteName?.trim() || host,
    provider: null,
    extras: {},
    degraded: true,
  };
}

function openCacheDatabase(cachePath: string): Database {
  mkdirSync(dirname(cachePath), { recursive: true });
  const database = new Database(cachePath, { create: true });
  database.exec(`
    CREATE TABLE IF NOT EXISTS link_card_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return database;
}

function resolveCachePath(
  configured: string | undefined,
  pluginDir: string,
): string {
  if (configured) {
    return configured.startsWith("/")
      ? configured
      : resolve(pluginDir, configured);
  }
  return resolve(pluginDir, "../../data/link-card-cache.sqlite");
}

function readCache(
  database: Database,
  key: string,
  options: { allowAny?: boolean } = {},
): LinkCardMetadata | null {
  const row = database
    .query(
      `SELECT payload FROM link_card_cache WHERE cache_key = ?`,
    )
    .get(key) as { payload: string } | null;
  if (!row) return null;
  try {
    const parsed = cachePayloadSchema.parse(JSON.parse(row.payload));
    if (!options.allowAny && parsed.degraded) {
      // Degraded entries are not treated as durable success cache.
      return null;
    }
    return parsed;
  } catch {
    database.query(`DELETE FROM link_card_cache WHERE cache_key = ?`).run(key);
    return null;
  }
}

function writeCache(
  database: Database,
  key: string,
  meta: LinkCardMetadata,
): void {
  if (meta.degraded) return;
  database
    .query(
      `INSERT INTO link_card_cache (cache_key, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(meta), Date.now());
}

function coalesce<T>(
  map: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = factory().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
}

function metaContent(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*property=["']${escapeRegExp(property)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*property=["']${escapeRegExp(property)}["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*name=["']${escapeRegExp(property)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*name=["']${escapeRegExp(property)}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function titleTag(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1];
}

function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

function absolutizeUrl(value: string, base: string): string | null {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPrivateOrReservedHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":")) {
    const lower = bare.toLowerCase();
    if (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    ) {
      return true;
    }
    return false;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    // Hostnames are allowed; DNS rebinding is out of scope for personal sites.
    return false;
  }
  const parts = bare.split(".").map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
