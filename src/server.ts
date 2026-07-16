import { removeRuntimeInfo, writeRuntimeInfo } from "./runtime-info.ts";
import { openPublication } from "./publication/runtime.ts";
import {
  isLoopbackHost,
  parsePublicOrigin,
  resolveAdminSecurity,
  type AdminSecurityConfig,
} from "./admin/security.ts";
import { createLogger, type Logger } from "./logger.ts";

export interface StartOptions {
  readonly root: string;
  readonly port: number;
  readonly host?: string;
  readonly adminToken?: string | null;
  readonly publicOrigin?: string | null;
  readonly logger?: Logger;
}

interface RunningSite {
  readonly url: URL;
  readonly logger: Logger;
  stop(): Promise<void>;
}

export async function startSite(options: StartOptions): Promise<RunningSite> {
  const logger = options.logger ?? createLogger();
  const host = options.host ?? "127.0.0.1";
  const adminToken = options.adminToken ?? null;
  const publicOrigin = options.publicOrigin
    ? parsePublicOrigin(options.publicOrigin, "public origin")
    : null;

  const security = resolveStartupSecurity({
    host,
    port: options.port,
    adminToken,
    publicOrigin,
  });

  const publication = await openPublication({
    root: options.root,
    security,
    logger,
  });

  const publicServer = Bun.serve({
    hostname: host,
    port: security.listenPort,
    async fetch(request, server) {
      return publication.handle(request, {
        clientAddress: server.requestIP(request)?.address,
      });
    },
  });

  if (
    security.enabled &&
    !publicOrigin &&
    publicServer.url.origin !== security.publicOrigin
  ) {
    publicServer.stop(true);
    await publication.close();
    throw new Error(
      `Bound origin ${publicServer.url.origin} does not match configured public origin ${security.publicOrigin}`,
    );
  }

  const token = crypto.randomUUID();
  const adminServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const client = server.requestIP(request);
      if (!client || !isLoopbackAddress(client.address)) {
        return new Response("Not Found", { status: 404 });
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/_system/status") {
        return Response.json(publication.status());
      }
      if (request.method === "POST" && url.pathname === "/_system/reload") {
        const result = await publication.reload();
        if (result.status === "in_progress") {
          return Response.json(result, { status: 409 });
        }
        if (result.status === "failed") {
          return Response.json(result, { status: 422 });
        }
        return Response.json(result);
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  const adminPort = adminServer.port;
  if (adminPort === undefined) {
    adminServer.stop(true);
    publicServer.stop(true);
    await publication.close();
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
    await publication.close();
    throw error;
  }

  logger.info(`Listening on ${publicServer.url.origin}`, {
    origin: publicServer.url.origin,
  });

  return {
    url: publicServer.url,
    logger,
    async stop() {
      logger.info("site shutting down");
      await publication.close();
      adminServer.stop(true);
      publicServer.stop(true);
      await removeRuntimeInfo(options.root);
    },
  };
}

function resolveStartupSecurity(options: {
  readonly host: string;
  readonly port: number;
  readonly adminToken: string | null;
  readonly publicOrigin: string | null;
}): AdminSecurityConfig & { readonly listenPort: number } {
  let listenPort = options.port;
  let boundOrigin: string | undefined;

  if (options.publicOrigin) {
    boundOrigin = options.publicOrigin;
  } else if (options.adminToken && isLoopbackHost(options.host)) {
    if (options.port === 0) {
      const probe = Bun.serve({
        hostname: options.host,
        port: 0,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });
      listenPort = probe.port ?? 0;
      boundOrigin = probe.url.origin;
      probe.stop(true);
      if (!listenPort) {
        throw new Error("Failed to reserve a publicServer port");
      }
    } else {
      boundOrigin = `http://${formatHostForUrl(options.host)}:${options.port}`;
    }
  }

  const security = resolveAdminSecurity({
    adminToken: options.adminToken,
    publicOrigin: options.publicOrigin,
    host: options.host,
    boundOrigin,
  });

  return Object.freeze({
    ...security,
    listenPort,
  });
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLoopbackAddress(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
