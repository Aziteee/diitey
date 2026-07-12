import { removeRuntimeInfo, writeRuntimeInfo } from "./runtime-info.ts";
import {
  buildInitialSnapshot,
  loadPublishingContext,
} from "./snapshot.ts";
import { SnapshotWorker } from "./snapshot-worker-client.ts";

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
  let snapshot = await buildInitialSnapshot(context);
  const snapshotWorker = await SnapshotWorker.create(options.root);
  let lastAttempt: BuildAttempt = {
    buildId: snapshot.version,
    result: "succeeded",
  };
  let activeBuildId: string | null = null;

  const publicServer = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch(request) {
      const requestSnapshot = snapshot;
      const url = new URL(request.url);
      if (url.pathname === "/_system" || url.pathname.startsWith("/_system/")) {
        return new Response("Not Found", { status: 404 });
      }
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const page = requestSnapshot.pages.find(
        (candidate) => normalizePath(url.pathname) === candidate.path,
      );
      if (!page) {
        return new Response("Not Found", { status: 404 });
      }

      let body = page.body;
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
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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
      adminServer.stop(true);
      publicServer.stop(true);
      await removeRuntimeInfo(options.root);
    },
  };
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
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
