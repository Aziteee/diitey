import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

const processes: SiteProcess[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const process of processes) process.kill();
  await Promise.all(processes.splice(0).map((process) => process.exited));
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("dynamic behavior loop", () => {
  test("the todo-list example migrates, creates, toggles, and lists items", async () => {
    const siteRoot = await copyFixtureSite();
    await enableTodoListExample(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const action = (name: string, input: unknown) =>
      fetch(`${address}/_action/${name}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: address,
        },
        body: JSON.stringify(input),
      });

    const before = await fetch(`${address}/todos`).then((response) =>
      response.text(),
    );
    const created = await action("todo.create", { title: "Write docs" });
    const createdItem = (await created.json()) as { id: number };
    const afterCreate = await fetch(`${address}/todos`).then((response) =>
      response.text(),
    );
    const toggled = await action("todo.toggle", { id: createdItem.id });
    const afterToggle = await fetch(`${address}/todos`).then((response) =>
      response.text(),
    );

    expect(before).toContain("<ul></ul>");
    expect(created.status).toBe(201);
    expect(afterCreate).toContain('data-completed="false"');
    expect(afterCreate).toContain("Write docs");
    expect(toggled.status).toBe(201);
    expect(afterToggle).toContain('data-completed="true"');
  }, 10_000);

  test("the todo-list plugin validates Action input with Zod", async () => {
    const siteRoot = await copyFixtureSite();
    await enableTodoListExample(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const create = (input: unknown) =>
      fetch(`${address}/_action/todo.create`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: address,
        },
        body: JSON.stringify(input),
      });

    const blank = await create({ title: "   " });
    const extra = await create({ title: "Valid", unexpected: true });
    const valid = await create({ title: "  Trimmed title  " });

    expect(blank.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(valid.status).toBe(201);
    expect(await valid.json()).toMatchObject({ title: "Trimmed title" });
  }, 10_000);

  test("the theme comment island submits through the core Action", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMemoryCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const manifest = await fetch(`${address}/assets/island-manifest.json`).then(
      (response) => response.json() as Promise<Record<string, string>>,
    );
    const bundle = await fetch(`${address}${manifest.comments}`).then((response) =>
      response.text(),
    );

    expect(html).toContain('data-diitey-island="comments"');
    expect(html).toContain("<ol></ol>");
    expect(bundle).toContain("/_action/comments.create");
  }, 10_000);

  test("a submitted comment is returned by the plugin service during SSR", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMemoryCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const before = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const created = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content", body: "First!" }),
    });
    const after = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(before).toContain("<ol></ol>");
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      contentId: "hello-content",
      body: "First!",
      status: "pending",
    });
    expect(after).toContain("<li>First!</li>");
  }, 10_000);

  test("startup migrates SQLite before comments can persist", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);

    const firstSite = spawnSite(siteRoot);
    const firstAddress = await readServerAddress(firstSite);
    const created = await fetch(`${firstAddress}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: firstAddress,
      },
      body: JSON.stringify({ contentId: "hello-content", body: "Stored" }),
    });
    firstSite.kill();
    await firstSite.exited;
    processes.splice(processes.indexOf(firstSite), 1);

    const secondSite = spawnSite(siteRoot);
    const secondAddress = await readServerAddress(secondSite);
    const html = await fetch(`${secondAddress}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(created.status).toBe(201);
    expect(html).toContain("<li>Stored</li>");
  }, 10_000);

  test("an Action rejects a body above its declared limit without creating a comment", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({
        contentId: "hello-content",
        body: "x".repeat(200),
      }),
    });
    const html = await fetch(`${address}/writing/hello`).then((result) =>
      result.text(),
    );

    expect(response.status).toBe(413);
    expect(html).toContain("<ol></ol>");
  }, 10_000);

  test("invalid Action input returns 400 without calling the plugin service", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content" }),
    });
    const html = await fetch(`${address}/writing/hello`).then((result) =>
      result.text(),
    );

    expect(response.status).toBe(400);
    expect(html).toContain("<ol></ol>");
  }, 10_000);

  test("the comments plugin rejects a comment for an unknown content ID", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "missing-content", body: "Lost" }),
    });
    const html = await fetch(`${address}/writing/hello`).then((result) =>
      result.text(),
    );

    expect(response.status).toBe(404);
    expect(html).toContain("<ol></ol>");
  }, 10_000);

  test("an Action rate limit rejects excess writes from the same client", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const submit = (body: string) =>
      fetch(`${address}/_action/comments.create`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: address,
        },
        body: JSON.stringify({ contentId: "hello-content", body }),
      });

    expect((await submit("One")).status).toBe(201);
    expect((await submit("Two")).status).toBe(201);
    const limited = await submit("Three");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(limited.status).toBe(429);
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<li>Two</li>");
    expect(html).not.toContain("<li>Three</li>");
  }, 10_000);

  test("a plugin exception becomes a standard Action error without leaking details", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content", body: "explode" }),
    });
    const responseBody = await response.text();
    const html = await fetch(`${address}/writing/hello`).then((result) =>
      result.text(),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).not.toBeNull();
    expect(responseBody).not.toContain("database connection secret");
    expect(html).toContain("<ol></ol>");
  }, 10_000);

  test("a timed out Action aborts a cooperative plugin write", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const startedAt = performance.now();
    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content", body: "slow" }),
    });
    const elapsedMs = performance.now() - startedAt;
    await Bun.sleep(120);
    const html = await fetch(`${address}/writing/hello`).then((result) =>
      result.text(),
    );

    expect(response.status).toBe(500);
    expect(elapsedMs).toBeLessThan(80);
    expect(response.headers.get("x-request-id")).not.toBeNull();
    expect(html).toContain("<ol></ol>");
  }, 10_000);

  test("a cookie-authenticated Action requires a matching CSRF token", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const pluginPath = join(siteRoot, "plugins", "comments", "plugin.ts");
    const pluginSource = await readFile(pluginPath, "utf8");
    await writeFile(
      pluginPath,
      pluginSource.replace("timeoutMs: 20,", 'timeoutMs: 20, credentials: "cookie",'),
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const page = await fetch(`${address}/writing/hello`);
    const setCookie = page.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";", 1)[0] ?? "";
    const token = cookie.split("=", 2)[1] ?? "";
    const submit = (csrfToken?: string) =>
      fetch(`${address}/_action/comments.create`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: address,
          cookie,
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ contentId: "hello-content", body: "CSRF safe" }),
      });

    expect(cookie).not.toBe("");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("HttpOnly");
    expect(setCookie).not.toContain("Secure");
    expect((await submit()).status).toBe(403);
    expect((await submit(token)).status).toBe(201);
  }, 10_000);

  test("a cookie-authenticated Action reads an encoded token among multiple cookies", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const pluginPath = join(siteRoot, "plugins", "comments", "plugin.ts");
    const pluginSource = await readFile(pluginPath, "utf8");
    await writeFile(
      pluginPath,
      pluginSource.replace("timeoutMs: 20,", 'timeoutMs: 20, credentials: "cookie",'),
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_action/comments.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
        cookie: "session=abc; diitey_csrf=token%3Dwith%20space; mode=dark",
        "x-csrf-token": "token=with space",
      },
      body: JSON.stringify({ contentId: "hello-content", body: "Encoded" }),
    });

    expect(response.status).toBe(201);
  }, 10_000);

  test("an SSR plugin service exception returns one standard 500 page", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);
    const pluginPath = join(siteRoot, "plugins", "comments", "plugin.ts");
    const pluginSource = await readFile(pluginPath, "utf8");
    await writeFile(
      pluginPath,
      pluginSource.replace(
        "return database.query(\n              \"SELECT content_id",
        "throw new Error(\"SSR database secret\");\n            return database.query(\n              \"SELECT content_id",
      ),
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/writing/hello`);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).not.toBeNull();
    expect(body).toContain("Page rendering failed");
    expect(body).not.toContain("SSR database secret");
    expect(body).not.toContain("<h1>Hello, Diitey</h1>");
  }, 10_000);

  test("a repeated migration is idempotent and a changed checksum is rejected", async () => {
    const siteRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(siteRoot);
    await enableComments(siteRoot);

    const first = spawnSite(siteRoot);
    await readServerAddress(first);
    await stopSite(first);
    const repeated = spawnSite(siteRoot);
    await readServerAddress(repeated);
    await stopSite(repeated);
    await writeSqliteCommentsPlugin(
      siteRoot,
      "CREATE TABLE comments (id INTEGER PRIMARY KEY, content_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL) ",
    );
    const changedError = await readStartupError(spawnSite(siteRoot));

    expect(changedError).toContain("Migration checksum changed");
  }, 10_000);

  test("startup rejects a database schema newer than the configured plugin", async () => {
    const newerRoot = await copyFixtureSite();
    await writeSqliteCommentsPlugin(newerRoot);
    await enableComments(newerRoot);
    const initial = spawnSite(newerRoot);
    await readServerAddress(initial);
    await stopSite(initial);
    const pluginPath = join(newerRoot, "plugins", "comments", "plugin.ts");
    const pluginSource = await readFile(pluginPath, "utf8");
    await writeFile(pluginPath, pluginSource.replace("schemaVersion: 1", "schemaVersion: 0"));
    const newerError = await readStartupError(spawnSite(newerRoot));

    expect(newerError).toContain("requires schema 0, database is 1");
  }, 10_000);

  test("startup rolls back all pending migrations when one migration fails", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFailingMigrationPlugin(siteRoot);
    await enableFailingMigrationPlugin(siteRoot);

    const error = await readStartupError(spawnSite(siteRoot));
    const database = new Database(join(siteRoot, "data", "site.sqlite"));
    const table = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'first_migration_table'",
      )
      .get();
    database.close();

    expect(error).toContain("no such table");
    expect(table).toBeNull();
  }, 10_000);

  test("plugin package management commands are not exposed", async () => {
    const siteRoot = await copyFixtureSite();
    const result = await runCli(siteRoot, ["plugin", "install", "todo-list"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Usage: diitey <start|reload|status>");
  });
});

async function writeMemoryCommentsPlugin(siteRoot: string): Promise<void> {
  const pluginRoot = join(siteRoot, "plugins", "comments");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "plugin.ts"),
    `import { definePlugin } from "../../../../../src/index.ts";

    interface Comment { contentId: string; body: string; status: "pending" }
    const comments: Comment[] = [];
    const listInput = {
      parse(value: unknown) {
        if (!value || typeof value !== "object") throw new Error("must be an object");
        const input = value as Record<string, unknown>;
        if (typeof input.contentId !== "string") throw new Error("contentId must be a string");
        return input;
      },
    };
    const createInput = {
      parse(value: unknown) {
        const input = listInput.parse(value);
        if (typeof input.body !== "string" || input.body.length < 1 || input.body.length > 100) {
          throw new Error("body must contain 1 to 100 characters");
        }
        return input;
      },
    };

    export default definePlugin({
      id: "comments",
      version: "1.0.0",
      schemaVersion: 0,
      services: {
        "comments.list": {
          input: listInput,
          output: { parse: (value: unknown) => value as Comment[] },
          handler(input) {
            return comments.filter((comment) => comment.contentId === input.contentId);
          },
        },
        "comments.create": {
          input: createInput,
          output: { parse: (value: unknown) => value as Comment },
          handler(input) {
            const comment: Comment = {
              contentId: String(input.contentId),
              body: String(input.body),
              status: "pending",
            };
            comments.push(comment);
            return comment;
          },
        },
      },
      actions: {
        "comments.create": {
          service: "comments.create",
          bodyLimitBytes: 128,
          rateLimit: { limit: 2, windowMs: 60000 },
        },
      },
    });
    `,
  );
}

async function writeSqliteCommentsPlugin(
  siteRoot: string,
  migrationSql = "CREATE TABLE comments (id INTEGER PRIMARY KEY, content_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL)",
): Promise<void> {
  const pluginRoot = join(siteRoot, "plugins", "comments");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "plugin.ts"),
    `import { definePlugin, PluginNotFoundError } from "../../../../../src/index.ts";

    const listInput = {
      parse(value: unknown) {
        if (!value || typeof value !== "object") throw new Error("must be an object");
        const input = value as Record<string, unknown>;
        if (typeof input.contentId !== "string") throw new Error("contentId must be a string");
        return input;
      },
    };
    const createInput = {
      parse(value: unknown) {
        const input = listInput.parse(value);
        if (typeof input.body !== "string" || input.body.length < 1 || input.body.length > 100) {
          throw new Error("body must contain 1 to 100 characters");
        }
        return input;
      },
    };

    export default definePlugin({
      id: "comments",
      version: "1.0.0",
      schemaVersion: 1,
      migrations: [{
        id: "0001-comments",
        schemaVersion: 1,
        sql: ${JSON.stringify(migrationSql)},
      }],
      services: {
        "comments.list": {
          input: listInput,
          output: { parse: (value: unknown) => value },
          handler(input, { database }) {
            return database.query(
              "SELECT content_id AS contentId, body, status FROM comments WHERE content_id = ? ORDER BY id",
            ).all(String(input.contentId));
          },
        },
        "comments.create": {
          input: createInput,
          output: { parse: (value: unknown) => value },
          async handler(input, { content, database, signal }) {
            if (input.body === "explode") {
              throw new Error("database connection secret");
            }
            if (input.body === "slow") {
              await Bun.sleep(100);
              if (signal.aborted) throw new Error("aborted");
            }
            if (!content.exists(String(input.contentId))) {
              throw new PluginNotFoundError("content does not exist");
            }
            const comment = {
              contentId: String(input.contentId),
              body: String(input.body),
              status: "pending",
            };
            database.query(
              "INSERT INTO comments (content_id, body, status) VALUES (?, ?, ?)",
            ).run(comment.contentId, comment.body, comment.status);
            return comment;
          },
        },
      },
      actions: {
        "comments.create": {
          service: "comments.create",
          bodyLimitBytes: 128,
          rateLimit: { limit: 2, windowMs: 60000 },
          timeoutMs: 20,
        },
      },
    });
    `,
  );
}

async function writeFailingMigrationPlugin(siteRoot: string): Promise<void> {
  const pluginRoot = join(siteRoot, "plugins", "failing-migration");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "plugin.ts"),
    `import { definePlugin } from "diitey";
    export default definePlugin({
      id: "failing-migration",
      version: "1.0.0",
      schemaVersion: 2,
      migrations: [
        {
          id: "0001-create-table",
          schemaVersion: 1,
          sql: "CREATE TABLE first_migration_table (id INTEGER PRIMARY KEY)",
        },
        {
          id: "0002-fail",
          schemaVersion: 2,
          sql: "INSERT INTO missing_table (id) VALUES (1)",
        },
      ],
    });\n`,
  );
}

async function enableFailingMigrationPlugin(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "diitey";
    export default defineSite({
      theme: "./themes/minimal/theme.ts",
      plugins: [
        "./plugins/todo-list/plugin.ts",
        "./plugins/failing-migration/plugin.ts",
      ],
    });\n`,
  );
}

async function enableComments(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "themes", "minimal", "islands"), {
    recursive: true,
  });
  await writeFile(
    join(siteRoot, "themes", "minimal", "islands", "comments.tsx"),
    `import { useState } from "preact/hooks";
    export default function Comments({ contentId }: { contentId: string }) {
      const [body, setBody] = useState("");
      return <form onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/_action/comments.create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentId, body }),
        });
        if (response.ok) location.reload();
      }}>
        <textarea value={body} onInput={(event) => setBody(event.currentTarget.value)} />
        <button type="submit">Submit comment</button>
      </form>;
    }
    `,
  );
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "../../../src/index.ts";
    export default defineSite({
      theme: "./themes/minimal/theme.ts",
      plugins: ["./plugins/comments/plugin.ts"],
    });
    `,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";
    export default defineTheme({
      collections: {
        writing: collection({ from: "hello.md", schema: { title: "string" } }),
      },
      routes: [
        route("/writing/hello", page("comments-article", {
          item: { collection: "writing", match: "hello.md" },
          comments: {
            service: "comments.list",
            input: { contentId: { from: "item.id" } },
          },
        })),
      ],
    });
    `,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "comments-article.tsx"),
    `import type { ContentRecord } from "../../../../../../src/index.ts";
    import { Island } from "../../../../../../src/index.ts";
    import Comments from "../islands/comments.tsx";
    interface Comment { body: string }
    export default function CommentsArticle({ item, comments }: {
      item: ContentRecord;
      comments: readonly Comment[];
    }) {
      return <main>
        <h1>{String(item.attributes.title)}</h1>
        <ol>{comments.map((comment) => <li>{comment.body}</li>)}</ol>
        <Island name="comments" component={Comments} props={{ contentId: item.id }} />
      </main>;
    }
    `,
  );
}

async function enableTodoListExample(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "../../../src/index.ts";
    export default defineSite({
      theme: "./themes/minimal/theme.ts",
      plugins: ["./plugins/todo-list/plugin.ts"],
    });
    `,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { defineTheme, page, route } from "../../../../../src/index.ts";
    export default defineTheme({
      collections: {},
      routes: [
        route("/todos", page("todos", {
          items: { service: "todo.list", input: {} },
        })),
      ],
    });
    `,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "todos.tsx"),
    `interface TodoItem { id: number; title: string; completed: boolean }
    export default function Todos({ items }: { items: readonly TodoItem[] }) {
      return <ul>{items.map((item) =>
        <li data-completed={String(item.completed)}>{item.title}</li>
      )}</ul>;
    }
    `,
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".dynamic-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  await rm(join(root, "data", "site.sqlite"), { force: true });
  return root;
}

async function runCli(
  siteRoot: string,
  args: readonly string[],
): Promise<{ exitCode: number; output: string; error: string }> {
  const process = Bun.spawn(
    [Bun.which("bun") ?? "bun", join(import.meta.dir, "..", "index.ts"), ...args, "--root", siteRoot],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, output, error };
}

function spawnSite(siteRoot: string): SiteProcess {
  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      join(import.meta.dir, "..", "index.ts"),
      "start",
      "--root",
      siteRoot,
      "--port",
      "0",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  processes.push(process);
  return process;
}

async function stopSite(process: SiteProcess): Promise<void> {
  process.kill();
  await process.exited;
  const index = processes.indexOf(process);
  if (index !== -1) processes.splice(index, 1);
}

async function readServerAddress(process: SiteProcess): Promise<string> {
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      const error = await new Response(process.stderr).text();
      throw new Error(`Server exited before listening.\n${output}${error}`);
    }
    output += decoder.decode(result.value, { stream: true });
    const match = output.match(/Listening on (http:\/\/[^\s]+)/);
    if (match?.[1]) return match[1];
  }
}

async function readStartupError(process: SiteProcess): Promise<string> {
  const exitCode = await Promise.race([
    process.exited,
    Bun.sleep(5_000).then(() => null),
  ]);
  if (exitCode === null) {
    process.kill();
    await process.exited;
  }
  return new Response(process.stderr).text();
}
