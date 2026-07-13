import { removeRuntimeInfo, writeRuntimeInfo } from "./runtime-info.ts";
import { openPublication } from "./publication/runtime.ts";

interface StartOptions {
  root: string;
  port: number;
}

interface RunningSite {
  readonly url: URL;
  stop(): Promise<void>;
}

export async function startSite(options: StartOptions): Promise<RunningSite> {
  const publication = await openPublication({ root: options.root });

  const publicServer = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request, server) {
      return publication.handle(request, {
        clientAddress: server.requestIP(request)?.address,
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

  return {
    url: publicServer.url,
    async stop() {
      await publication.close();
      adminServer.stop(true);
      publicServer.stop(true);
      await removeRuntimeInfo(options.root);
    },
  };
}

function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
