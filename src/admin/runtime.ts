import type { Database } from "bun:sqlite";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { type ComponentType } from "preact";
import {
  callPluginService,
  createContentLookup,
  PluginInputError,
  PluginNotFoundError,
  type PluginRuntime,
} from "../plugins.ts";
import { runWithTimeout } from "../plugin-invoke.ts";
import { createActionRateLimiter } from "../rate-limit.ts";
import { renderPageWithIslands } from "../islands.ts";
import type { EffectivePublication } from "../publication/effective-publication.ts";
import { AdminDocument } from "./document.tsx";
import {
  AdminErrorPage,
  AdminHomePage,
  AdminLoginPage,
  AdminPluginIslandPage,
} from "./pages.tsx";
import type { AdminProgram, AdminPluginPage } from "./program.ts";
import {
  ADMIN_COOKIE_PATH,
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  constantTimeEqual,
  createCsrfToken,
  createSessionToken,
  LOGIN_BODY_LIMIT_BYTES,
  LOGIN_RATE_LIMIT,
  type AdminSecurityConfig,
  verifySessionToken,
} from "./security.ts";

export interface AdminRuntime {
  handle(
    request: Request,
    context?: { readonly clientAddress?: string },
  ): Promise<Response>;
}

export interface AdminRuntimeOptions {
  readonly adminProgram: AdminProgram;
  readonly plugins: PluginRuntime;
  readonly pluginDatabase: Database;
  readonly getPublication: () => EffectivePublication;
  readonly security: AdminSecurityConfig;
  readonly now?: () => number;
}

const ADMIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const emptyIslands = Object.freeze({
  manifest: Object.freeze({} as Record<string, string>),
  assets: Object.freeze([] as { path: string; body: string }[]),
  runtimePath: "",
});

export function createAdminRuntime(
  options: AdminRuntimeOptions,
): AdminRuntime {
  const rateLimiter = createActionRateLimiter();
  const loginFailures = new Map<string, { count: number; resetAt: number }>();
  const pagesById = new Map(
    options.adminProgram.pages.map((page) => [page.pluginId, page] as const),
  );

  return Object.freeze({
    async handle(
      request: Request,
      context: { readonly clientAddress?: string } = {},
    ) {
      if (!options.security.enabled || !options.security.token) {
        return notFound();
      }

      const url = new URL(request.url);
      const path = normalizeAdminPath(url.pathname);
      if (path === null) return notFound();

      const clientAddress = context.clientAddress ?? "unknown";
      const token = options.security.token;
      const nowMs = options.now?.() ?? Date.now();
      const sessionValid = hasValidSession(request, token, nowMs);

      if (path === "/_admin/login") {
        if (request.method === "GET") {
          if (sessionValid) return redirect("/_admin");
          return renderLogin(options.adminProgram, null, options.security);
        }
        if (request.method === "POST") {
          return handleLogin(
            request,
            options.adminProgram,
            options.security,
            loginFailures,
            clientAddress,
            nowMs,
          );
        }
        return methodNotAllowed();
      }

      if (path === "/_admin/logout") {
        if (request.method !== "POST") return methodNotAllowed();
        return handleLogout(request, options.security, sessionValid);
      }

      if (
        path === "/_admin/assets/core.css" ||
        isCoreStylesheet(path, options.adminProgram)
      ) {
        if (request.method !== "GET") return methodNotAllowed();
        return serveCoreStyles(options.adminProgram, path);
      }

      if (!sessionValid) {
        if (
          path.startsWith("/_admin/assets/") ||
          path.startsWith("/_admin/action/")
        ) {
          return unauthorized();
        }
        if (request.method === "GET") {
          return redirect("/_admin/login");
        }
        return unauthorized();
      }

      if (path === "/_admin/assets/island-manifest.json") {
        if (request.method !== "GET") return methodNotAllowed();
        return Response.json(options.adminProgram.islands.manifest, {
          headers: {
            ...securityHeaders(),
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
        });
      }

      if (path.startsWith("/_admin/assets/")) {
        if (request.method !== "GET") return methodNotAllowed();
        return serveAdminAsset(options.adminProgram, path);
      }

      if (path.startsWith("/_admin/action/")) {
        if (request.method !== "POST") return methodNotAllowed();
        return handleAdminAction(
          request,
          path,
          options,
          rateLimiter,
          clientAddress,
          token,
          nowMs,
        );
      }

      if (request.method !== "GET") return methodNotAllowed();

      const csrfToken = ensureCsrfCookieValue(request);
      if (path === "/_admin") {
        return renderShell({
          title: "Admin",
          Page: AdminHomePage,
          data: {
            pages: options.adminProgram.pages.map((page) => ({
              pluginId: page.pluginId,
              title: page.title,
            })),
          },
          adminProgram: options.adminProgram,
          security: options.security,
          csrfToken,
          showNav: true,
        });
      }

      const pluginId = path.slice("/_admin/".length);
      if (!pluginId || pluginId.includes("/")) return notFound();
      const page = pagesById.get(pluginId);
      if (!page) return notFound();

      return renderPluginAdminPage({
        page,
        adminProgram: options.adminProgram,
        plugins: options.plugins,
        pluginDatabase: options.pluginDatabase,
        publication: options.getPublication(),
        security: options.security,
        csrfToken,
      });
    },
  });
}

function isCoreStylesheet(path: string, program: AdminProgram): boolean {
  return (
    program.coreStylesheetPath !== null && path === program.coreStylesheetPath
  );
}

function serveCoreStyles(program: AdminProgram, path: string): Response {
  const body = program.coreStylesheetBody;
  if (!body) return notFound();
  if (path === "/_admin/assets/core.css") {
    return new Response(body, {
      headers: {
        ...securityHeaders(),
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (program.coreStylesheetPath && path === program.coreStylesheetPath) {
    return new Response(body, {
      headers: {
        ...securityHeaders(),
        "content-type": "text/css; charset=utf-8",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  }
  return notFound();
}

function serveAdminAsset(program: AdminProgram, path: string): Response {
  if (path === program.coreStylesheetPath && program.coreStylesheetBody) {
    return new Response(program.coreStylesheetBody, {
      headers: {
        ...securityHeaders(),
        "content-type": "text/css; charset=utf-8",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  }
  const body = program.islands.assets.find((asset) => asset.path === path)?.body;
  if (body === undefined) return notFound();
  return new Response(body, {
    headers: {
      ...securityHeaders(),
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

async function handleLogin(
  request: Request,
  program: AdminProgram,
  security: AdminSecurityConfig,
  loginFailures: Map<string, { count: number; resetAt: number }>,
  clientAddress: string,
  nowMs: number,
): Promise<Response> {
  if (!security.token) return notFound();

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return new Response("Unsupported Media Type", { status: 415 });
  }

  if (request.headers.get("origin") !== security.publicOrigin) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > LOGIN_BODY_LIMIT_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }

  const failureKey = `admin-login:${clientAddress}`;
  const existing = loginFailures.get(failureKey);
  if (existing && existing.resetAt > nowMs && existing.count >= LOGIN_RATE_LIMIT.limit) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const params = new URLSearchParams(new TextDecoder().decode(body));
  const submitted = params.get("token") ?? "";
  if (!constantTimeEqual(submitted, security.token)) {
    const entry =
      existing && existing.resetAt > nowMs
        ? existing
        : { count: 0, resetAt: nowMs + LOGIN_RATE_LIMIT.windowMs };
    entry.count += 1;
    loginFailures.set(failureKey, entry);
    if (entry.count > LOGIN_RATE_LIMIT.limit) {
      return new Response("Too Many Requests", { status: 429 });
    }
    return renderLogin(program, "Invalid token", security, 401);
  }

  loginFailures.delete(failureKey);
  const session = createSessionToken(security.token, nowMs);
  const csrf = createCsrfToken();
  const headers = new Headers({
    location: "/_admin",
    ...securityHeaders(),
  });
  appendSetCookie(
    headers,
    serializeAdminCookie(ADMIN_SESSION_COOKIE, session, security, {
      httpOnly: true,
    }),
  );
  appendSetCookie(
    headers,
    serializeAdminCookie(ADMIN_CSRF_COOKIE, csrf, security, {
      httpOnly: false,
    }),
  );
  return new Response(null, { status: 303, headers });
}

async function handleLogout(
  request: Request,
  security: AdminSecurityConfig,
  sessionValid: boolean,
): Promise<Response> {
  if (!sessionValid) return unauthorized();
  if (request.headers.get("origin") !== security.publicOrigin) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!(await verifyAdminCsrf(request))) {
    return new Response("Forbidden", { status: 403 });
  }
  const headers = new Headers({
    location: "/_admin/login",
    ...securityHeaders(),
  });
  appendSetCookie(headers, clearAdminCookie(ADMIN_SESSION_COOKIE, security));
  appendSetCookie(headers, clearAdminCookie(ADMIN_CSRF_COOKIE, security));
  return new Response(null, { status: 303, headers });
}

async function handleAdminAction(
  request: Request,
  path: string,
  options: AdminRuntimeOptions,
  rateLimiter: ReturnType<typeof createActionRateLimiter>,
  clientAddress: string,
  token: string,
  nowMs: number,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const rest = path.slice("/_admin/action/".length);
  const segments = rest.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return new Response("Not Found", {
      status: 404,
      headers: { "x-request-id": requestId },
    });
  }
  const [pluginId, actionName] = segments;
  const action = options.plugins.adminActions[pluginId!]?.[actionName!];
  if (!action) {
    return new Response("Not Found", {
      status: 404,
      headers: { "x-request-id": requestId },
    });
  }

  if (!hasValidSession(request, token, nowMs)) {
    return unauthorized(requestId);
  }
  if (request.headers.get("origin") !== options.security.publicOrigin) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "x-request-id": requestId },
    });
  }
  if (!(await verifyAdminCsrf(request, true))) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "x-request-id": requestId },
    });
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return new Response("Unsupported Media Type", {
      status: 415,
      headers: { "x-request-id": requestId },
    });
  }

  const rateLimit = action.rateLimit ?? { limit: 60, windowMs: 60_000 };
  if (
    !rateLimiter.consume(
      `admin:${clientAddress}:${pluginId}:${actionName}`,
      rateLimit,
    )
  ) {
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

  const publication = options.getPublication();
  const contentLookup = createContentLookup(publication.content.byId);

  try {
    const parsedBody = JSON.parse(new TextDecoder().decode(body));
    const result = await runWithTimeout(action.timeoutMs ?? 5_000, (signal) =>
      callPluginService(
        options.plugins,
        action.service,
        parsedBody,
        options.pluginDatabase,
        contentLookup,
        signal,
      ),
    );
    return Response.json(result, {
      status: 201,
      headers: { "x-request-id": requestId, ...securityHeaders() },
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
    console.error(
      JSON.stringify({
        requestId,
        action: `${pluginId}/${actionName}`,
        status: 500,
        durationMs: performance.now() - startedAt,
        error: error instanceof Error ? error.stack : String(error),
      }),
    );
    return Response.json(
      { error: "Action failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

async function renderPluginAdminPage(options: {
  readonly page: AdminPluginPage;
  readonly adminProgram: AdminProgram;
  readonly plugins: PluginRuntime;
  readonly pluginDatabase: Database;
  readonly publication: EffectivePublication;
  readonly security: AdminSecurityConfig;
  readonly csrfToken: string;
}): Promise<Response> {
  const requestId = crypto.randomUUID();
  let data: unknown = null;
  if (options.page.dataService) {
    try {
      const contentLookup = createContentLookup(
        options.publication.content.byId,
      );
      data = await runWithTimeout(5_000, (signal) =>
        callPluginService(
          options.plugins,
          options.page.dataService!,
          {},
          options.pluginDatabase,
          contentLookup,
          signal,
        ),
      );
      assertJsonSerializable(data);
    } catch (error) {
      console.error(
        JSON.stringify({
          requestId,
          page: options.page.pluginId,
          status: 500,
          error: error instanceof Error ? error.stack : String(error),
        }),
      );
      return renderShell({
        title: "Error",
        Page: AdminErrorPage,
        data: {
          title: "Page rendering failed",
          message: "Admin page data could not be loaded.",
          requestId,
        },
        adminProgram: options.adminProgram,
        security: options.security,
        csrfToken: options.csrfToken,
        showNav: true,
        status: 500,
        requestId,
      });
    }
  }

  return renderShell({
    title: options.page.title,
    Page: AdminPluginIslandPage,
    data: {
      islandName: options.page.islandName,
      Component: options.page.Component,
      data,
    },
    adminProgram: options.adminProgram,
    security: options.security,
    csrfToken: options.csrfToken,
    showNav: true,
    useIslands: true,
  });
}

function renderLogin(
  program: AdminProgram,
  error: string | null,
  security: AdminSecurityConfig,
  status = 200,
): Response {
  return renderShell({
    title: "Admin login",
    Page: AdminLoginPage,
    data: { error },
    adminProgram: program,
    security,
    csrfToken: null,
    showNav: false,
    status,
  });
}

function renderShell(options: {
  readonly title: string;
  readonly Page: ComponentType<Record<string, unknown>>;
  readonly data: Record<string, unknown>;
  readonly adminProgram: AdminProgram;
  readonly security: AdminSecurityConfig;
  readonly csrfToken: string | null;
  readonly showNav: boolean;
  readonly status?: number;
  readonly requestId?: string;
  readonly useIslands?: boolean;
}): Response {
  const navPages = options.adminProgram.pages.map((page) => ({
    pluginId: page.pluginId,
    title: page.title,
  }));

  const Document: ComponentType<{
    title: string;
    children?: preact.ComponentChildren;
  }> = (props) =>
    AdminDocument({
      title: props.title,
      stylesheetPath:
        options.adminProgram.coreStylesheetPath ?? "/_admin/assets/core.css",
      csrfToken: options.csrfToken,
      showNav: options.showNav,
      pages: navPages,
      children: props.children,
    });

  const islands = options.useIslands
    ? options.adminProgram.islands
    : emptyIslands;

  const body = renderPageWithIslands(
    options.Page,
    options.data,
    islands,
    null,
    {
      Document,
      title: options.title,
      stylesheetPath: options.adminProgram.coreStylesheetPath,
    },
  );

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  if (options.requestId) {
    headers.set("x-request-id", options.requestId);
  }
  if (options.csrfToken) {
    headers.append(
      "set-cookie",
      serializeAdminCookie(
        ADMIN_CSRF_COOKIE,
        options.csrfToken,
        options.security,
        { httpOnly: false },
      ),
    );
  }
  return new Response(`<!doctype html>${body}`, {
    status: options.status ?? 200,
    headers,
  });
}

function hasValidSession(
  request: Request,
  token: string,
  nowMs: number,
): boolean {
  const value = readCookie(request, ADMIN_SESSION_COOKIE);
  if (!value) return false;
  return verifySessionToken(value, token, nowMs);
}

async function verifyAdminCsrf(
  request: Request,
  headerOnly = false,
): Promise<boolean> {
  const cookie = readCookie(request, ADMIN_CSRF_COOKIE);
  if (!cookie) return false;
  const header = request.headers.get("x-csrf-token");
  if (header && constantTimeEqual(header, cookie)) return true;
  if (headerOnly) return false;
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    try {
      const body = await request.clone().text();
      const params = new URLSearchParams(body);
      const formToken = params.get("csrf") ?? "";
      return constantTimeEqual(formToken, cookie);
    } catch {
      return false;
    }
  }
  return false;
}

function ensureCsrfCookieValue(request: Request): string {
  return readCookie(request, ADMIN_CSRF_COOKIE) ?? createCsrfToken();
}

function serializeAdminCookie(
  name: string,
  value: string,
  security: AdminSecurityConfig,
  options: { readonly httpOnly: boolean },
): string {
  return serializeCookie(name, value, {
    path: ADMIN_COOKIE_PATH,
    sameSite: "lax",
    httpOnly: options.httpOnly,
    secure: security.secureCookies,
  });
}

function clearAdminCookie(
  name: string,
  security: AdminSecurityConfig,
): string {
  return serializeCookie(name, "", {
    path: ADMIN_COOKIE_PATH,
    sameSite: "lax",
    httpOnly: name === ADMIN_SESSION_COOKIE,
    secure: security.secureCookies,
    maxAge: 0,
  });
}

function appendSetCookie(headers: Headers, value: string): void {
  headers.append("set-cookie", value);
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": ADMIN_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function normalizeAdminPath(pathname: string): string | null {
  if (pathname === "/_admin" || pathname === "/_admin/") return "/_admin";
  if (!pathname.startsWith("/_admin/")) return null;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

function readCookie(request: Request, name: string): string | undefined {
  return parseCookie(request.headers.get("cookie") ?? "")[name];
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function unauthorized(requestId?: string): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: requestId ? { "x-request-id": requestId } : undefined,
  });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", { status: 405 });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      ...securityHeaders(),
    },
  });
}

function assertJsonSerializable(value: unknown): void {
  const seen = new Set<object>();
  const walk = (candidate: unknown): void => {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new Error("Non-finite number");
      return;
    }
    if (typeof candidate !== "object") {
      throw new Error("Unsupported JSON value");
    }
    if (seen.has(candidate)) throw new Error("Circular reference");
    const prototype = Object.getPrototypeOf(candidate);
    if (
      !Array.isArray(candidate) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new Error("Non-plain object");
    }
    seen.add(candidate);
    for (const child of Array.isArray(candidate)
      ? candidate
      : Object.values(candidate)) {
      walk(child);
    }
    seen.delete(candidate);
  };
  walk(value);
}
