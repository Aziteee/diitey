import type { Database } from "bun:sqlite";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
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
  buildEffectivePublication,
  materializePublication,
  type EffectivePublication,
} from "./effective-publication.ts";
import { PageRequestError } from "./page-plan.ts";
import { compileSiteProgram, type SiteProgram } from "./site-program.ts";
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
  }): Promise<ReloadResult>;
  status(): PublicationStatus;
  close(): Promise<void>;
}

export async function openPublication(options: {
  readonly root: string;
  readonly security?: AdminSecurityConfig;
  readonly logger?: Logger;
}): Promise<PublicationRuntime> {
  const log = options.logger ?? createSilentLogger();
  log.info("opening publication", { root: options.root });
  let program: SiteProgram;
  try {
    program = await compileSiteProgram(options.root);
    log.info("site program compiled", {
      programRevision: program.programRevision,
      pluginCount: program.pluginDefinitions.length,
      routeCount: program.pagePlans.length,
      islandCount: Object.keys(program.islands.manifest).length,
      hasThemeStyles: program.styles.stylesheetPath !== null,
      reloadTimeoutMs: program.reloadTimeoutMs,
    });
  } catch (error) {
    log.error("site program compilation failed", {
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
  const adminProgram = await compileAdminProgram({
    enabled: security.enabled,
    siteRoot: options.root,
    plugins: program.pluginEntries,
  });
  log.info("admin program compiled", {
    enabled: security.enabled,
    pluginPageCount: adminProgram.pages.length,
  });
  const content = await buildContentSnapshot(program);
  log.info("content snapshot built", {
    contentCount: content.byId.size,
  });
  let publication = buildEffectivePublication(program, content);
  log.info("effective publication ready", {
    snapshotVersion: publication.version,
    routeCount: publication.routesByPath.size,
  });
  const snapshotWorker = await SnapshotWorker.create(
    options.root,
    program.programRevision,
    program.islands,
    program.styles,
  );
  log.info("snapshot worker ready", {
    programRevision: program.programRevision,
  });
  const pluginDatabase = await preparePluginDatabase(
    options.root,
    program.pluginDefinitions,
    log,
  );
  log.info("publication runtime ready", {
    snapshotVersion: publication.version,
  });

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

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      if (url.pathname === "/assets/island-manifest.json") {
        return Response.json(requestPublication.islandManifest, {
          headers: { "cache-control": "no-store" },
        });
      }

      const islandBody = requestPublication.islandAssetsByPath.get(url.pathname);
      if (islandBody !== undefined) {
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
        return new Response("Not Found", { status: 404 });
      }

      const plan = requestPublication.plansById.get(entry.planId);
      if (!plan) {
        return new Response("Not Found", { status: 404 });
      }

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
        const html = program.usesDocument
          ? `<!doctype html>${body}`
          : `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(entry.title)}</title></head><body>${body}</body></html>`;
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
        return new Response(html, { headers });
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
        );
        if (candidate.programRevision !== program.programRevision) {
          throw new Error(
            "Snapshot programRevision does not match the startup site program; restart the site",
          );
        }
        publication = materializePublication(program, candidate);
        lastAttempt = { buildId, result: "succeeded" };
        log.info("content reload succeeded", {
          buildId,
          snapshotVersion: publication.version,
        });
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
