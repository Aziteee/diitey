import { removeRuntimeInfo, writeRuntimeInfo } from "./runtime-info.ts";
import {
  buildInitialSnapshot,
  loadPublishingContext,
} from "./snapshot.ts";
import { SnapshotWorker } from "./snapshot-worker-client.ts";
import {
  buildServiceInput,
  callPluginService,
  PluginInputError,
  PluginNotFoundError,
} from "./plugins.ts";
import { renderPageWithIslands } from "./islands.ts";
import { openPluginDatabase } from "./plugin-database.ts";

interface StartOptions {
  root: string;
  port: number;
}

type BuildAttempt =
  | {
      readonly buildId: string;
      readonly result: "succeeded";
    }
  | {
      readonly buildId: string;
      readonly result: "failed";
      readonly error: string;
    };

interface RunningSite {
  readonly url: URL;
  stop(): Promise<void>;
}

export async function startSite(options: StartOptions): Promise<RunningSite> {
  const context = await loadPublishingContext(options.root);
  const pluginDatabase = await openPluginDatabase(
    options.root,
    context.pluginDefinitions,
  );
  let snapshot = await buildInitialSnapshot(context);
  const snapshotWorker = await SnapshotWorker.create(options.root);
  let lastAttempt: BuildAttempt = {
    buildId: snapshot.version,
    result: "succeeded",
  };
  let activeBuildId: string | null = null;
  const rateLimits = new Map<string, { startedAt: number; count: number }>();

  const publicServer = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request, server) {
      const requestSnapshot = snapshot;
      const url = new URL(request.url);
      if (url.pathname === "/_system" || url.pathname.startsWith("/_system/")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.pathname.startsWith("/_action/")) {
        const actionName = url.pathname.slice("/_action/".length);
        const action = context.plugins.actions[actionName];
        if (!action) return new Response("Not Found", { status: 404 });
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
          if (
            !csrfCookie ||
            request.headers.get("x-csrf-token") !== csrfCookie
          ) {
            return new Response("Forbidden", {
              status: 403,
              headers: { "x-request-id": requestId },
            });
          }
        }
        const clientAddress = server.requestIP(request)?.address ?? "unknown";
        const rateLimit = action.rateLimit ?? { limit: 60, windowMs: 60_000 };
        if (
          !consumeRateLimit(
            rateLimits,
            `${clientAddress}:${actionName}`,
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
        try {
          const parsedBody = JSON.parse(new TextDecoder().decode(body));
          const result = await runWithTimeout(
            action.timeoutMs ?? 5_000,
            (signal) =>
              callPluginService(
                context.plugins,
                action.service,
                parsedBody,
                pluginDatabase,
                new Set(requestSnapshot.contentIds),
                signal,
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
          console.error(
            JSON.stringify({
              requestId,
              action: actionName,
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
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (url.pathname === "/assets/island-manifest.json") {
        return Response.json(requestSnapshot.islands.manifest, {
          headers: { "cache-control": "no-store" },
        });
      }
      const islandAsset = requestSnapshot.islands.assets.find(
        (candidate) => candidate.path === url.pathname,
      );
      if (islandAsset) {
        return new Response(islandAsset.body, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }
      const page = requestSnapshot.pages.find(
        (candidate) => normalizePath(url.pathname) === candidate.path,
      );
      if (!page) {
        return new Response("Not Found", { status: 404 });
      }

      const renderStartedAt = performance.now();
      try {
        let body = page.dynamic
          ? await renderDynamicPage(
              context,
              page.dynamic,
              pluginDatabase,
              new Set(requestSnapshot.contentIds),
            )
          : page.body;
        if (page.pagination) {
          const values = url.searchParams.getAll("page");
          const value = values[0] ?? "1";
          if (values.length > 1 || !/^[1-9]\d*$/.test(value)) {
            return new Response("Invalid page", { status: 400 });
          }
          const pageNumber = Number(value);
          if (!Number.isSafeInteger(pageNumber)) {
            return new Response("Invalid page", { status: 400 });
          }
          body = page.pagination.bodies[pageNumber - 1] ?? page.pagination.emptyBody;
        }
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title></head><body>${body}</body></html>`;
        const headers: Record<string, string> = {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        };
        if (
          Object.values(context.plugins.actions).some(
            (action) => action.credentials === "cookie",
          )
        ) {
          const csrfToken =
            readCookie(request, "diitey_csrf") ?? crypto.randomUUID();
          headers["set-cookie"] = `diitey_csrf=${csrfToken}; Path=/; SameSite=Strict`;
        }
        return new Response(html, {
          headers,
        });
      } catch (error) {
        const requestId = crypto.randomUUID();
        console.error(
          JSON.stringify({
            requestId,
            services: page.dynamic?.services.map(([, binding]) => binding.service),
            status: 500,
            durationMs: performance.now() - renderStartedAt,
            error: error instanceof Error ? error.stack : String(error),
          }),
        );
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
  });

  const token = crypto.randomUUID();
  const adminServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const client = server.requestIP(request);
      if (!client || !isLoopback(client.address)) {
        return new Response("Not Found", { status: 404 });
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/_system/status") {
        return Response.json({
          currentSnapshotVersion: snapshot.version,
          lastSuccessfulAt: snapshot.publishedAt,
          lastAttempt,
          reloading: activeBuildId !== null,
          ...(activeBuildId === null ? {} : { activeBuildId }),
        });
      }
      if (request.method === "POST" && url.pathname === "/_system/reload") {
        if (activeBuildId !== null) {
          return Response.json(
            {
              status: "in_progress",
              buildId: activeBuildId,
              snapshotVersion: snapshot.version,
            },
            { status: 409 },
          );
        }

        const buildId = crypto.randomUUID();
        activeBuildId = buildId;
        try {
          const nextSnapshot = await snapshotWorker.build(
            buildId,
            context.reloadTimeoutMs,
          );
          snapshot = nextSnapshot;
          lastAttempt = { buildId, result: "succeeded" };
          return Response.json({
            status: "succeeded",
            buildId,
            snapshotVersion: snapshot.version,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastAttempt = { buildId, result: "failed", error: message };
          return Response.json(
            {
              status: "failed",
              buildId,
              error: message,
              snapshotVersion: snapshot.version,
            },
            { status: 422 },
          );
        } finally {
          activeBuildId = null;
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  const adminPort = adminServer.port;
  if (adminPort === undefined) {
    adminServer.stop(true);
    publicServer.stop(true);
    throw new Error("Management server did not expose a port");
  }

  try {
    await writeRuntimeInfo(options.root, {
      pid: process.pid,
      adminPort,
      token,
    });
  } catch (error) {
    adminServer.stop(true);
    publicServer.stop(true);
    throw error;
  }

  return {
    url: publicServer.url,
    async stop() {
      snapshotWorker.close();
      pluginDatabase.close();
      adminServer.stop(true);
      publicServer.stop(true);
      await removeRuntimeInfo(options.root);
    },
  };
}

function consumeRateLimit(
  entries: Map<string, { startedAt: number; count: number }>,
  key: string,
  limit: { readonly limit: number; readonly windowMs: number },
): boolean {
  const now = Date.now();
  const entry = entries.get(key);
  if (!entry || now - entry.startedAt >= limit.windowMs) {
    entries.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (entry.count >= limit.limit) return false;
  entry.count += 1;
  return true;
}

async function renderDynamicPage(
  context: Awaited<ReturnType<typeof loadPublishingContext>>,
  dynamic: NonNullable<
    Awaited<ReturnType<typeof buildInitialSnapshot>>["pages"][number]["dynamic"]
  >,
  pluginDatabase: import("bun:sqlite").Database,
  contentIds: ReadonlySet<string>,
): Promise<string> {
  const route = context.routes.find(
    (candidate) => candidate.definition.page.name === dynamic.pageName,
  );
  if (!route) throw new Error(`Unknown dynamic page: ${dynamic.pageName}`);
  const serviceData = await Promise.all(
    dynamic.services.map(async ([name, binding]) => [
      name,
      await runWithTimeout(
        5_000,
        (signal) =>
          callPluginService(
            context.plugins,
            binding.service,
            buildServiceInput(binding, dynamic.data),
            pluginDatabase,
            contentIds,
            signal,
          ),
      ),
    ] as const),
  );
  return renderPageWithIslands(
    route.Page,
    { ...dynamic.data, ...Object.fromEntries(serviceData) },
    context.islands,
  );
}

async function runWithTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Plugin service timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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

function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) return valueParts.join("=");
  }
  return undefined;
}
