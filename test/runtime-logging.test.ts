import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createLogger, parseLogLevel } from "../src/logger.ts";
import { openPublication } from "../src/publication/runtime.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("runtime logger factory", () => {
  test("default level is info and emits JSON lines to the destination", () => {
    const { records, destination } = captureDestination();
    const log = createLogger({ destination, isTTY: false });

    log.info("site listening");
    log.warn("degraded path");
    log.error("request failed");

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ level: 30, msg: "site listening" });
    expect(records[1]).toMatchObject({ level: 40, msg: "degraded path" });
    expect(records[2]).toMatchObject({ level: 50, msg: "request failed" });
  });

  test("DIITEY_LOG_LEVEL=error drops info and warn", () => {
    const previous = process.env.DIITEY_LOG_LEVEL;
    process.env.DIITEY_LOG_LEVEL = "error";
    try {
      const { records, destination } = captureDestination();
      const log = createLogger({
        destination,
        isTTY: false,
      });

      log.info("startup ok");
      log.warn("soft warning");
      log.error("hard failure");

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ level: 50, msg: "hard failure" });
    } finally {
      if (previous === undefined) delete process.env.DIITEY_LOG_LEVEL;
      else process.env.DIITEY_LOG_LEVEL = previous;
    }
  });

  test("invalid DIITEY_LOG_LEVEL fails loud", () => {
    expect(() => parseLogLevel("debug")).toThrow(/DIITEY_LOG_LEVEL/);
    expect(() => parseLogLevel("trace")).toThrow(/DIITEY_LOG_LEVEL/);
    expect(() => parseLogLevel("verbose")).toThrow(/DIITEY_LOG_LEVEL/);
  });

  test("child logger attaches pluginId binding", () => {
    const { records, destination } = captureDestination();
    const root = createLogger({ destination, isTTY: false });
    const pluginLog = root.child({ pluginId: "todo-list" });

    pluginLog.info("created item");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 30,
      msg: "created item",
      pluginId: "todo-list",
    });
  });
});

describe("openPublication runtime logging", () => {
  test("plugin service handler can log with plugin attribution", async () => {
    const siteRoot = await copyFixtureSite();
    await writeLoggingPlugin(siteRoot);
    const { records, destination } = captureDestination();
    const log = createLogger({ destination, isTTY: false });

    const publication = await openPublication({
      root: siteRoot,
      logger: log,
    });
    try {
      const response = await publication.handle(
        new Request("http://127.0.0.1:3000/_action/log.ping", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ message: "hello from plugin" }),
        }),
      );
      expect(response.status).toBe(201);
      const pluginLines = records.filter(
        (record) =>
          record.pluginId === "log-probe" &&
          record.msg === "hello from plugin",
      );
      expect(pluginLines).toHaveLength(1);
      expect(pluginLines[0]).toMatchObject({ level: 30 });
    } finally {
      await publication.close();
    }
  });

  test("reload success and failure each produce lifecycle log records", async () => {
    const siteRoot = await copyFixtureSite();
    const { records, destination } = captureDestination();
    const log = createLogger({ destination, isTTY: false });

    const publication = await openPublication({
      root: siteRoot,
      logger: log,
    });
    try {
      const succeeded = await publication.reload();
      expect(succeeded.status).toBe("succeeded");
      const successLogs = records.filter(
        (record) =>
          typeof record.msg === "string" &&
          /reload/i.test(record.msg) &&
          record.level === 30,
      );
      expect(successLogs.length).toBeGreaterThanOrEqual(1);
      await forceReloadFailure(publication, records);
    } finally {
      await publication.close();
    }
  });

  test("unhandled action failure emits an error-level log", async () => {
    const siteRoot = await copyFixtureSite();
    await writeThrowingActionPlugin(siteRoot);
    const { records, destination } = captureDestination();
    const log = createLogger({ destination, isTTY: false });

    const publication = await openPublication({
      root: siteRoot,
      logger: log,
    });
    try {
      const response = await publication.handle(
        new Request("http://127.0.0.1:3000/_action/boom.fire", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).toBe(500);
      const errors = records.filter(
        (record) =>
          record.level === 50 &&
          typeof record.msg === "string" &&
          /action failed/i.test(record.msg),
      );
      expect(errors.length).toBeGreaterThanOrEqual(1);
    } finally {
      await publication.close();
    }
  });
});

function captureDestination(): {
  records: Array<Record<string, unknown>>;
  destination: Writable;
} {
  const records: Array<Record<string, unknown>> = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        records.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { records, destination };
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "tmp-logging-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
}

async function writeLoggingPlugin(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "plugins", "log-probe"), { recursive: true });
  await writeFile(
    join(siteRoot, "plugins", "log-probe", "plugin.ts"),
    `import { definePlugin } from "diitey";
import { z } from "zod";

export default definePlugin({
  id: "log-probe",
  version: "1.0.0",
  services: {
    "log.ping": {
      input: z.object({ message: z.string() }).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      handler(input, context) {
        context.log.info(input.message);
        return { ok: true as const };
      },
    },
  },
  actions: {
    "log.ping": {
      service: "log.ping",
    },
  },
});
`,
  );
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "diitey";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: [
    "./plugins/todo-list/plugin.ts",
    "./plugins/log-probe/plugin.ts",
  ],
});
`,
  );
}

async function writeThrowingActionPlugin(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "plugins", "boom"), { recursive: true });
  await writeFile(
    join(siteRoot, "plugins", "boom", "plugin.ts"),
    `import { definePlugin } from "diitey";
import { z } from "zod";

export default definePlugin({
  id: "boom",
  version: "1.0.0",
  services: {
    "boom.fire": {
      input: z.object({}).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      handler() {
        throw new Error("intentional action failure");
      },
    },
  },
  actions: {
    "boom.fire": {
      service: "boom.fire",
    },
  },
});
`,
  );
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "diitey";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: [
    "./plugins/todo-list/plugin.ts",
    "./plugins/boom/plugin.ts",
  ],
});
`,
  );
}

async function forceReloadFailure(
  publication: Awaited<ReturnType<typeof openPublication>>,
  records: Array<Record<string, unknown>>,
): Promise<void> {
  const controller = new AbortController();
  controller.abort();
  const failed = await publication.reload({ signal: controller.signal });
  expect(failed.status).toBe("failed");
  const errorLogs = records.filter(
    (record) =>
      record.level === 50 &&
      typeof record.msg === "string" &&
      /reload/i.test(record.msg),
  );
  expect(errorLogs.length).toBeGreaterThanOrEqual(1);
}
