import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPublication } from "../src/publication/runtime.ts";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  createSessionToken,
  resolveAdminSecurity,
} from "../src/admin/security.ts";
import { parse as parseCookie } from "cookie";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

const processes: SiteProcess[] = [];
const temporaryRoots: string[] = [];
const ADMIN_TOKEN = "a".repeat(32);

afterEach(async () => {
  for (const process of processes) process.kill();
  await Promise.all(processes.splice(0).map((process) => process.exited));
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("admin surface", () => {
  test("disabled admin returns 404 for the entire /_admin namespace", async () => {
    const siteRoot = await copyFixtureSite();
    const security = resolveAdminSecurity({
      adminToken: null,
      publicOrigin: null,
      host: "127.0.0.1",
      boundOrigin: "http://127.0.0.1:3000",
    });
    const publication = await openPublication({ root: siteRoot, security });
    try {
      for (const path of [
        "/_admin",
        "/_admin/login",
        "/_admin/assets/core.css",
        "/_admin/action/todo-list/clear",
      ]) {
        const response = await publication.handle(
          new Request(`http://127.0.0.1:3000${path}`),
        );
        expect(response.status).toBe(404);
      }
    } finally {
      await publication.close();
    }
  });

  test("startup rejects short admin tokens before serving", async () => {
    const siteRoot = await copyFixtureSite();
    const site = spawnSite(siteRoot, ["--admin-token", "too-short"]);
    const error = await readStartupError(site);
    expect(error).toMatch(/at least 32 UTF-8 bytes/i);
  });

  test("login succeeds, sets host-only Path=/_admin cookies without Secure on loopback HTTP", async () => {
    const siteRoot = await copyFixtureSite();
    await writeAdminPlugin(siteRoot);
    const publication = await openEnabledPublication(siteRoot);
    try {
      const login = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "http://127.0.0.1:3000",
          },
          body: `token=${ADMIN_TOKEN}`,
        }),
      );
      expect(login.status).toBe(303);
      expect(login.headers.get("location")).toBe("/_admin");
      const cookies = login.headers.getSetCookie();
      const session = cookies.find((value) =>
        value.startsWith(`${ADMIN_SESSION_COOKIE}=`),
      );
      const csrf = cookies.find((value) =>
        value.startsWith(`${ADMIN_CSRF_COOKIE}=`),
      );
      expect(session).toBeDefined();
      expect(csrf).toBeDefined();
      expect(session!.toLowerCase()).toContain("httponly");
      expect(session!.toLowerCase()).toContain("path=/_admin");
      expect(session!.toLowerCase()).toContain("samesite=lax");
      expect(session!.toLowerCase()).not.toContain("secure");
      expect(csrf!.toLowerCase()).not.toContain("httponly");
      expect(csrf!.toLowerCase()).not.toContain("secure");
      expect(session).not.toContain(ADMIN_TOKEN);
    } finally {
      await publication.close();
    }
  });

  test("login accepts localhost origin and Chromium Origin null on same-origin navigate", async () => {
    const siteRoot = await copyFixtureSite();
    const publication = await openEnabledPublication(siteRoot);
    try {
      const localhost = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "http://localhost:3000",
          },
          body: `token=${ADMIN_TOKEN}`,
        }),
      );
      expect(localhost.status).toBe(303);

      const nullOrigin = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "null",
            host: "localhost:3000",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "navigate",
          },
          body: `token=${ADMIN_TOKEN}`,
        }),
      );
      expect(nullOrigin.status).toBe(303);

      const bareNull = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "null",
          },
          body: `token=${ADMIN_TOKEN}`,
        }),
      );
      expect(bareNull.status).toBe(403);
    } finally {
      await publication.close();
    }
  });

  test("authenticated operator sees admin home and plugin page without theme chrome", async () => {
    const siteRoot = await copyFixtureSite();
    await writeAdminPlugin(siteRoot);
    const publication = await openEnabledPublication(siteRoot);
    try {
      const cookie = await loginCookie(publication);
      const home = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin", {
          headers: { cookie },
        }),
      );
      const homeHtml = await home.text();
      expect(home.status).toBe(200);
      expect(home.headers.get("cache-control")).toBe("no-store");
      expect(home.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(homeHtml).toContain("Admin");
      expect(homeHtml).toContain("/_admin/notes");
      expect(homeHtml).not.toContain('data-theme="minimal"');

      const page = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/notes", {
          headers: { cookie },
        }),
      );
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(pageHtml).toContain('data-diitey-island="admin-notes"');
      expect(pageHtml).toContain("hello from dataService");
      expect(pageHtml).toContain("/_admin/assets/");
    } finally {
      await publication.close();
    }
  });

  test("plugin admin stylesheet is linked only on that page and requires a session", async () => {
    const siteRoot = await copyFixtureSite();
    await writeAdminPlugin(siteRoot);
    const publication = await openEnabledPublication(siteRoot);
    try {
      const cookie = await loginCookie(publication);
      const home = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin", {
          headers: { cookie },
        }),
      );
      const homeHtml = await home.text();
      expect(homeHtml).not.toMatch(/\/_admin\/assets\/plugin-notes-/);

      const page = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/notes", {
          headers: { cookie },
        }),
      );
      const pageHtml = await page.text();
      const styleMatch = pageHtml.match(
        /\/_admin\/assets\/plugin-notes-[a-f0-9]+\.css/,
      );
      expect(styleMatch).toBeTruthy();
      const stylePath = styleMatch![0]!;

      const denied = await publication.handle(
        new Request(`http://127.0.0.1:3000${stylePath}`),
      );
      expect(denied.status).toBe(401);

      const allowed = await publication.handle(
        new Request(`http://127.0.0.1:3000${stylePath}`, {
          headers: { cookie },
        }),
      );
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("content-type")).toContain("text/css");
      const css = await allowed.text();
      expect(css.length).toBeGreaterThan(0);
      expect(allowed.headers.get("cache-control")).toContain("immutable");
    } finally {
      await publication.close();
    }
  });

  test("admin Action requires session, origin, and CSRF; public path cannot call it", async () => {
    const siteRoot = await copyFixtureSite();
    await writeAdminPlugin(siteRoot);
    const publication = await openEnabledPublication(siteRoot);
    try {
      const publicCall = await publication.handle(
        new Request("http://127.0.0.1:3000/_action/notes.clear", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: "{}",
        }),
      );
      expect(publicCall.status).toBe(404);

      const unauth = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/action/notes/clear", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: "{}",
        }),
      );
      expect(unauth.status).toBe(401);

      const { cookie, csrf } = await loginSession(publication);
      const missingCsrf = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/action/notes/clear", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
            cookie,
          },
          body: "{}",
        }),
      );
      expect(missingCsrf.status).toBe(403);

      const ok = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin/action/notes/clear", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
            cookie,
            "x-csrf-token": csrf,
          },
          body: "{}",
        }),
      );
      expect(ok.status).toBe(201);
      expect(await ok.json()).toMatchObject({ cleared: true });
    } finally {
      await publication.close();
    }
  });

  test("tampered or rotated-token sessions are rejected", async () => {
    const siteRoot = await copyFixtureSite();
    const publication = await openEnabledPublication(siteRoot);
    try {
      const tampered = `${ADMIN_SESSION_COOKIE}=v1.e30.badmac; Path=/_admin`;
      const response = await publication.handle(
        new Request("http://127.0.0.1:3000/_admin", {
          headers: { cookie: tampered },
        }),
      );
      expect(response.status).toBe(303);
    } finally {
      await publication.close();
    }

    const rotated = await openPublication({
      root: siteRoot,
      security: resolveAdminSecurity({
        adminToken: "c".repeat(32),
        publicOrigin: "http://127.0.0.1:3000",
        host: "127.0.0.1",
      }),
    });
    try {
      const oldSession = createSessionToken(ADMIN_TOKEN);
      const response = await rotated.handle(
        new Request("http://127.0.0.1:3000/_admin", {
          headers: {
            cookie: `${ADMIN_SESSION_COOKIE}=${oldSession}`,
          },
        }),
      );
      expect(response.status).toBe(303);
    } finally {
      await rotated.close();
    }
  });

  test("HTTPS public origin marks admin cookies Secure", async () => {
    const siteRoot = await copyFixtureSite();
    const security = resolveAdminSecurity({
      adminToken: ADMIN_TOKEN,
      publicOrigin: "https://example.com",
      host: "127.0.0.1",
    });
    expect(security.secureCookies).toBe(true);
    const publication = await openPublication({ root: siteRoot, security });
    try {
      const login = await publication.handle(
        new Request("https://example.com/_admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://example.com",
          },
          body: `token=${ADMIN_TOKEN}`,
        }),
      );
      const cookies = login.headers.getSetCookie().join("\n").toLowerCase();
      expect(cookies).toContain("secure");
    } finally {
      await publication.close();
    }
  });
});

async function openEnabledPublication(siteRoot: string) {
  return openPublication({
    root: siteRoot,
    security: resolveAdminSecurity({
      adminToken: ADMIN_TOKEN,
      publicOrigin: "http://127.0.0.1:3000",
      host: "127.0.0.1",
    }),
  });
}

async function loginCookie(
  publication: Awaited<ReturnType<typeof openPublication>>,
): Promise<string> {
  const session = await loginSession(publication);
  return session.cookie;
}

async function loginSession(
  publication: Awaited<ReturnType<typeof openPublication>>,
): Promise<{ cookie: string; csrf: string }> {
  const login = await publication.handle(
    new Request("http://127.0.0.1:3000/_admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://127.0.0.1:3000",
      },
      body: `token=${ADMIN_TOKEN}`,
    }),
  );
  expect(login.status).toBe(303);
  const cookies = login.headers.getSetCookie();
  const jar: string[] = [];
  let csrf = "";
  for (const raw of cookies) {
    const parsed = parseCookie(raw.split(";", 1)[0] ?? "");
    for (const [name, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      jar.push(`${name}=${value}`);
      if (name === ADMIN_CSRF_COOKIE) csrf = value;
    }
  }
  expect(csrf).toBeTruthy();
  return { cookie: jar.join("; "), csrf };
}

async function writeAdminPlugin(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "plugins", "notes"), { recursive: true });
  await writeFile(
    join(siteRoot, "plugins", "notes", "plugin.ts"),
    `
      import { definePlugin } from "diitey";
      import { z } from "zod";

      export default definePlugin({
        id: "notes",
        adminPage: {
          component: "./admin.tsx",
          title: "Notes",
          dataService: "notes.list",
          styles: "admin",
        },
        services: {
          "notes.list": {
            input: z.object({}).strict(),
            output: z.object({ message: z.string() }).strict(),
            handler() {
              return { message: "hello from dataService" };
            },
          },
          "notes.clear": {
            input: z.object({}).strict(),
            output: z.object({ cleared: z.boolean() }).strict(),
            handler() {
              return { cleared: true };
            },
          },
          "notes.contentSummary": {
            input: z.object({ contentId: z.string() }).strict(),
            output: z
              .object({
                id: z.string(),
                created: z.string(),
                sourcePath: z.string(),
                url: z.string(),
                attributes: z.record(z.string(), z.unknown()),
              })
              .strict()
              .nullable(),
            handler(input, { content }) {
              return content.get(input.contentId) ?? null;
            },
          },
        },
        actions: {
          clear: {
            service: "notes.clear",
            access: "admin",
          },
          "content-summary": {
            service: "notes.contentSummary",
            access: "admin",
          },
        },
      });
    `,
  );
  await writeFile(
    join(siteRoot, "plugins", "notes", "admin.tsx"),
    `
      export default function NotesAdmin(props: { data: { message: string } | null }) {
        return (
          <div class="rounded-xl border border-zinc-800 p-4">
            <h1 class="text-xl font-semibold">Notes admin</h1>
            <p class="text-sm text-zinc-400">{props.data?.message ?? "null data"}</p>
          </div>
        );
      }
    `,
  );
  await writeFile(
    join(siteRoot, "plugins", "notes", "admin.css"),
    `
      @import "tailwindcss";
      @source "./admin.tsx";
    `,
  );
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `
      import { defineSite } from "diitey";
      export default defineSite({
        theme: {
          use: "./themes/minimal/theme.ts",
          config: {
            siteName: "Diitey Minimal Site",
            articlePageSize: 2,
            homeIntro: "Welcome to the Diitey minimal site.",
          },
        },
        plugins: [
          {
            use: "./plugins/todo-list/plugin.ts",
            config: { maxTitleLength: 100 },
          },
          "./plugins/notes/plugin.ts",
        ],
      });
    `,
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".admin-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
}

function spawnSite(siteRoot: string, extraArgs: string[] = []): SiteProcess {
  const child = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      join(import.meta.dir, "..", "index.ts"),
      "start",
      "--root",
      siteRoot,
      "--port",
      "0",
      ...extraArgs,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  processes.push(child);
  return child;
}

async function readStartupError(process: SiteProcess): Promise<string> {
  const stderr = await new Response(process.stderr).text();
  const stdout = await new Response(process.stdout).text();
  await process.exited;
  return `${stderr}\n${stdout}`;
}
