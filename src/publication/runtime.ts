import type { Database } from "bun:sqlite";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { PluginRequestMeta } from "../index.ts";
import { runWithTimeout } from "../plugin-invoke.ts";
import {
  callPluginService,
  createContentLookup,
  PluginInputError,
  PluginNotFoundError,
} from "../plugins.ts";
import { preparePluginDatabase } from "../plugin-database.ts";
import { createActionRateLimiter } from "../rate-limit.ts";
import {
  createAdminRuntime,
  type AdminRuntime,
} from "../admin/runtime.ts";
import type { AdminSecurityConfig } from "../admin/security.ts";
import { compileAdminProgram } from "../admin/program.ts";
import type { Logger } from "../logger.ts";
import { createSilentLogger } from "../silent-logger.ts";
import { buildContentSnapshot } from "./content-snapshot.ts";
import {
  collectArtifactCache,
  contentResourceCacheRoot,
  type ContentResource,
} from "./content-resources.ts";
import { pluginAssetCacheRoot } from "./plugin-assets.ts";
import {
  buildEffectivePublication,
  materializePublication,
  type EffectivePublication,
} from "./effective-publication.ts";
import {
  PageRequestError,
  type CompiledPagePlan,
  type PublishedRouteEntry,
} from "./page-plan.ts";
import { compileSiteProgram, type SiteProgram } from "./site-program.ts";
import {
  siteStaticAssetMethodNotAllowed,
  tryServeSiteStaticAsset,
} from "./site-static-assets.ts";
import { SnapshotWorker } from "./snapshot-worker-client.ts";

export type BuildAttempt =
  | {
      readonly buildId: string;
      readonly result: "succeeded";
    }
  | {
      readonly buildId: string;
      readonly result: "failed";
      readonly error: string;
    };

export type ReloadResult =
  | {
      readonly status: "succeeded";
      readonly buildId: string;
      readonly snapshotVersion: string;
    }
  | {
      readonly status: "failed";
      readonly buildId: string;
      readonly error: string;
      readonly snapshotVersion: string;
    }
  | {
      readonly status: "in_progress";
      readonly buildId: string;
      readonly snapshotVersion: string;
    };

export interface PublicationStatus {
  readonly currentSnapshotVersion: string;
  readonly lastSuccessfulAt: string;
  readonly lastAttempt: BuildAttempt;
  readonly reloading: boolean;
  readonly activeBuildId?: string;
}

export interface PublicationRuntime {
  handle(
    request: Request,
    context?: { readonly clientAddress?: string },
  ): Promise<Response>;
  reload(options?: {
    readonly buildId?: string;
    readonly signal?: AbortSignal;
    readonly ensureContentFields?: boolean;
  }): Promise<ReloadResult>;
  status(): PublicationStatus;
  close(): Promise<void>;
}

export async function openPublication(options: {
  readonly root: string;
  readonly security?: AdminSecurityConfig;
  readonly logger?: Logger;
  readonly ensureContentFields?: boolean;
}): Promise<PublicationRuntime> {
  const log = options.logger ?? createSilentLogger();
  let program: SiteProgram;
  const siteProgramStartedAt = performance.now();
  try {
    program = await compileSiteProgram(options.root);
    log.info("site program compiled", {
      durationMs: performance.now() - siteProgramStartedAt,
      programRevision: program.programRevision,
      pluginCount: program.pluginDefinitions.length,
    });
  } catch (error) {
    log.error("site program compilation failed", {
      durationMs: performance.now() - siteProgramStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const security =
    options.security ??
    Object.freeze({
      enabled: false,
      token: null,
      publicOrigin: "http://127.0.0.1",
      secureCookies: false,
    });
  const adminStartedAt = performance.now();
  const adminProgram = await compileAdminProgram({
    enabled: security.enabled,
    siteRoot: options.root,
    plugins: program.pluginEntries,
  });
  log.info("admin program compiled", {
    durationMs: performance.now() - adminStartedAt,
    pageCount: adminProgram.pages.length,
    enabled: adminProgram.enabled,
  });
  const contentStartedAt = performance.now();
  const content = await buildContentSnapshot(program, {
    ensureContentFields: options.ensureContentFields === true,
    logger: log,
  });
  log.info("content snapshot built", {
    durationMs: performance.now() - contentStartedAt,
    recordCount: content.records.length,
    resourceCount: content.resources.length,
  });
  let publication = buildEffectivePublication(program, content);
  const resourcesStartedAt = performance.now();
  await collectPublishedContentResources(program, publication, log);
  await collectPluginAssets(program, publication, log);
  log.info("content resource cache ready", {
    durationMs: performance.now() - resourcesStartedAt,
    resourceCount: publication.content.resources.length,
  });
  const workerStartedAt = performance.now();
  const snapshotWorker = await SnapshotWorker.create(
    options.root,
    program.programRevision,
    program.islands,
    program.styles,
    program.pluginAssets,
  );
  log.info("snapshot worker ready", {
    durationMs: performance.now() - workerStartedAt,
  });
  const pluginDatabase = await preparePluginDatabase(
    options.root,
    program.pluginDefinitions,
    log,
  );

  let lastAttempt: BuildAttempt = {
    buildId: publication.version,
    result: "succeeded",
  };
  let activeBuildId: string | null = null;
  let closed = false;
  const rateLimiter = createActionRateLimiter();
  const hasCookieActions = Object.values(program.plugins.actions).some(
    (action) => action.credentials === "cookie",
  );
  const adminRuntime: AdminRuntime = createAdminRuntime({
    adminProgram,
    plugins: program.plugins,
    pluginDatabase,
    getPublication: () => publication,
    security,
    logger: log,
  });

  return {
    async handle(request, context = {}) {
      if (closed) {
        return new Response("Service Unavailable", { status: 503 });
      }
      const requestPublication = publication;
      const url = new URL(request.url);

      if (url.pathname === "/_system" || url.pathname.startsWith("/_system/")) {
        return new Response("Not Found", { status: 404 });
      }

      if (
        url.pathname === "/_admin" ||
        url.pathname.startsWith("/_admin/")
      ) {
        return adminRuntime.handle(request, context);
      }

      if (url.pathname.startsWith("/_action/")) {
        return handleAction(
          request,
          url,
          program,
          requestPublication,
          pluginDatabase,
          rateLimiter,
          context.clientAddress ?? "unknown",
          log,
        );
      }

      if (url.pathname.startsWith("/assets/content/")) {
        const resource = requestPublication.contentResourcesByPath.get(
          url.pathname,
        );
        if (!resource) {
          return new Response("Not Found", { status: 404 });
        }
        return serveContentResource(request, resource, log);
      }

      if (url.pathname.startsWith("/assets/plugins/")) {
        const resource = requestPublication.pluginAssetsByPath.get(url.pathname);
        if (!resource) return new Response("Not Found", { status: 404 });
        return serveContentResource(request, resource, log);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        const path = normalizePath(url.pathname);
        if (!requestPublication.routesByPath.has(path)) {
          const publicMethod = await siteStaticAssetMethodNotAllowed(
            request,
            options.root,
          );
          if (publicMethod) return publicMethod;
        }
        return new Response("Method Not Allowed", { status: 405 });
      }

      if (url.pathname === "/assets/island-manifest.json") {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        return Response.json(requestPublication.islandManifest, {
          headers: { "cache-control": "no-store" },
        });
      }

      const islandBody = requestPublication.islandAssetsByPath.get(url.pathname);
      if (islandBody !== undefined) {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        return new Response(islandBody, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }

      const themeAssetBody = requestPublication.themeAssetsByPath.get(
        url.pathname,
      );
      if (themeAssetBody !== undefined) {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        return new Response(themeAssetBody, {
          headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }

      const path = normalizePath(url.pathname);
      const entry = requestPublication.routesByPath.get(path);
      if (!entry) {
        const siteStatic = await tryServeSiteStaticAsset(
          request,
          options.root,
        );
        if (siteStatic) return siteStatic;
        if (request.method !== "GET" || !program.notFoundPlan) {
          return new Response("Not Found", { status: 404 });
        }
        return renderThemePageResponse({
          plan: program.notFoundPlan,
          entry: {
            path,
            title: "Not Found",
            planId: program.notFoundPlan.id,
            publishData: Object.freeze({}),
          },
          request,
          url,
          program,
          pluginDatabase,
          log,
          requestPublication,
          hasCookieActions,
          status: 404,
        });
      }

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const plan = requestPublication.plansById.get(entry.planId);
      if (!plan) {
        return new Response("Not Found", { status: 404 });
      }

      return renderThemePageResponse({
        plan,
        entry,
        request,
        url,
        program,
        pluginDatabase,
        log,
        requestPublication,
        hasCookieActions,
      });
    },

    async reload(reloadOptions = {}) {
      if (closed) {
        return {
          status: "failed",
          buildId: reloadOptions.buildId ?? crypto.randomUUID(),
          error: "Publication runtime is closed",
          snapshotVersion: publication.version,
        };
      }
      if (activeBuildId !== null) {
        log.info("content reload in progress", {
          buildId: activeBuildId,
          snapshotVersion: publication.version,
        });
        return {
          status: "in_progress",
          buildId: activeBuildId,
          snapshotVersion: publication.version,
        };
      }

      const buildId = reloadOptions.buildId ?? crypto.randomUUID();
      activeBuildId = buildId;
      log.info("content reload started", {
        buildId,
        snapshotVersion: publication.version,
      });
      try {
        if (reloadOptions.signal?.aborted) {
          throw new Error("Reload was cancelled");
        }
        const candidate = await snapshotWorker.build(
          buildId,
          program.reloadTimeoutMs,
          {
            ensureContentFields: reloadOptions.ensureContentFields === true,
          },
        );
        if (candidate.programRevision !== program.programRevision) {
          throw new Error(
            "Snapshot programRevision does not match the startup site program; restart the site",
          );
        }
        publication = materializePublication(program, candidate);
        await collectPublishedContentResources(program, publication, log);
        lastAttempt = { buildId, result: "succeeded" };
        log.info("content reload succeeded", {
          buildId,
          snapshotVersion: publication.version,
        });
        const ensured = candidate.ensuredContentFields;
        if (ensured && (ensured.ensuredIds > 0 || ensured.ensuredCreated > 0)) {
          log.info("content fields ensured", {
            buildId,
            ensuredIds: ensured.ensuredIds,
            ensuredCreated: ensured.ensuredCreated,
          });
        }
        return {
          status: "succeeded",
          buildId,
          snapshotVersion: publication.version,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastAttempt = { buildId, result: "failed", error: message };
        log.error("content reload failed", {
          buildId,
          snapshotVersion: publication.version,
          error: message,
        });
        return {
          status: "failed",
          buildId,
          error: message,
          snapshotVersion: publication.version,
        };
      } finally {
        activeBuildId = null;
      }
    },

    status() {
      return {
        currentSnapshotVersion: publication.version,
        lastSuccessfulAt: publication.publishedAt,
        lastAttempt,
        reloading: activeBuildId !== null,
        ...(activeBuildId === null ? {} : { activeBuildId }),
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      snapshotWorker.close();
      pluginDatabase.close();
    },
  };
}

async function serveContentResource(
  request: Request,
  resource: ContentResource,
  log: Logger,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const file = Bun.file(resource.cachePath);
  if (!(await file.exists())) {
    log.error("content resource cache artifact unavailable", {
      publicPath: resource.publicPath,
      digest: resource.digest,
    });
    return new Response("Internal Server Error", { status: 500 });
  }

  const headers = {
    "content-type": resource.mediaType,
    "content-length": String(resource.byteLength),
    etag: `"${resource.digest}"`,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }
  return new Response(file, { headers });
}

async function collectPublishedContentResources(
  program: SiteProgram,
  publication: EffectivePublication,
  log: Logger,
): Promise<void> {
  try {
    await collectArtifactCache({
      cacheRoot: contentResourceCacheRoot(program.root),
      referencedDigests: new Set(
        publication.content.resources.map((resource) => resource.digest),
      ),
    });
  } catch (error) {
    log.error("content resource cache cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function collectPluginAssets(
  program: SiteProgram,
  publication: EffectivePublication,
  log: Logger,
): Promise<void> {
  try {
    await collectArtifactCache({
      cacheRoot: pluginAssetCacheRoot(program.root),
      referencedDigests: new Set(
        [...publication.pluginAssetsByPath.values()].map((resource) => resource.digest),
      ),
    });
  } catch (error) {
    log.error("plugin asset cache cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function injectPluginHead(html: string, fragments: readonly string[]): string {
  if (fragments.length === 0) return html;
  const closingHead = html.toLowerCase().indexOf("</head>");
  if (closingHead < 0) return html;
  return `${html.slice(0, closingHead)}${fragments.join("")}${html.slice(closingHead)}`;
}

async function renderThemePageResponse(options: {
  readonly plan: CompiledPagePlan;
  readonly entry: PublishedRouteEntry;
  readonly request: Request;
  readonly url: URL;
  readonly program: SiteProgram;
  readonly pluginDatabase: Database;
  readonly log: Logger;
  readonly requestPublication: EffectivePublication;
  readonly hasCookieActions: boolean;
  readonly status?: number;
}): Promise<Response> {
  const {
    plan,
    entry,
    request,
    url,
    program,
    pluginDatabase,
    log,
    requestPublication,
    hasCookieActions,
    status = 200,
  } = options;
  const renderStartedAt = performance.now();
  try {
    const body = await plan.render(entry, request, {
      pluginRuntime: program.plugins,
      pluginDatabase,
      logger: log,
      islands: program.islands,
      styles: program.styles,
      contentIds: requestPublication.contentIds,
      contentById: requestPublication.content.byId,
    });
    const rendered = program.usesDocument
      ? `<!doctype html>${body}`
      : `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(entry.title)}</title></head><body>${body}</body></html>`;
    const html = injectPluginHead(
      rendered,
      requestPublication.pluginHeadFragments,
    );
    const headers: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    };
    if (hasCookieActions) {
      const csrfToken =
        readCookie(request, "diitey_csrf") ?? crypto.randomUUID();
      headers["set-cookie"] = serializeCookie("diitey_csrf", csrfToken, {
        path: "/",
        sameSite: "strict",
        secure: url.protocol === "https:",
      });
    }
    return new Response(html, { status, headers });
  } catch (error) {
    if (error instanceof PageRequestError) {
      return new Response(error.message, { status: error.status });
    }
    const requestId = crypto.randomUUID();
    log.error("page render failed", {
      requestId,
      page: plan.pageName,
      status: 500,
      durationMs: performance.now() - renderStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      `<!doctype html><html><body><h1>Page rendering failed</h1><p>Request ID: ${requestId}</p></body></html>`,
      {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  }
}

async function handleAction(
  request: Request,
  url: URL,
  program: SiteProgram,
  publication: EffectivePublication,
  pluginDatabase: Database,
  rateLimiter: ReturnType<typeof createActionRateLimiter>,
  clientAddress: string,
  log: Logger,
): Promise<Response> {
  const actionName = url.pathname.slice("/_action/".length);
  const action = program.plugins.actions[actionName];
  if (!action || action.access === "admin") {
    return new Response("Not Found", { status: 404 });
  }
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "x-request-id": requestId },
    });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return new Response("Unsupported Media Type", {
      status: 415,
      headers: { "x-request-id": requestId },
    });
  }
  if (request.headers.get("origin") !== url.origin) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "x-request-id": requestId },
    });
  }
  if (action.credentials === "cookie") {
    const csrfCookie = readCookie(request, "diitey_csrf");
    if (!csrfCookie || request.headers.get("x-csrf-token") !== csrfCookie) {
      return new Response("Forbidden", {
        status: 403,
        headers: { "x-request-id": requestId },
      });
    }
  }
  const rateLimit = action.rateLimit ?? { limit: 60, windowMs: 60_000 };
  if (!rateLimiter.consume(`${clientAddress}:${actionName}`, rateLimit)) {
    return Response.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "x-request-id": requestId } },
    );
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > (action.bodyLimitBytes ?? 65_536)) {
    return Response.json(
      { error: "Request body too large" },
      { status: 413, headers: { "x-request-id": requestId } },
    );
  }
  try {
    const parsedBody = JSON.parse(new TextDecoder().decode(body));
    const result = await runWithTimeout(action.timeoutMs ?? 5_000, (signal) =>
      callPluginService(
        program.plugins,
        action.service,
        parsedBody,
        pluginDatabase,
        createContentLookup(publication.content.byId),
        signal,
        log,
        buildPublicActionRequestMeta(request, clientAddress),
      ),
    );
    return Response.json(result, {
      status: 201,
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    if (error instanceof PluginInputError || error instanceof SyntaxError) {
      return Response.json(
        { error: "Invalid Action input" },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }
    if (error instanceof PluginNotFoundError) {
      return Response.json(
        { error: "Not found" },
        { status: 404, headers: { "x-request-id": requestId } },
      );
    }
    log.error("action failed", {
      requestId,
      action: actionName,
      status: 500,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Action failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

function buildPublicActionRequestMeta(
  request: Request,
  clientAddress: string,
): PluginRequestMeta {
  const meta: {
    clientAddress?: string;
    userAgent?: string;
  } = {};
  if (clientAddress !== "" && clientAddress !== "unknown") {
    meta.clientAddress = clientAddress;
  }
  const userAgent = request.headers.get("user-agent")?.trim();
  if (userAgent) {
    meta.userAgent = userAgent;
  }
  return Object.freeze(meta);
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

function readCookie(request: Request, name: string): string | undefined {
  return parseCookie(request.headers.get("cookie") ?? "")[name];
}
