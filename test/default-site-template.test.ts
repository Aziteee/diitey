import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

const processes: SiteProcess[] = [];

afterEach(async () => {
  for (const process of processes) {
    process.kill();
  }
  await Promise.all(processes.splice(0).map((process) => process.exited));
});

describe("default site template", () => {
  test("void keeps home static and adds article scroll navigation to posts", async () => {
    const process = spawnSite();
    const address = await readServerAddress(process);

    const [homeResponse, postResponse] = await Promise.all([
      fetch(address),
      fetch(`${address}/archives/negative-space`),
    ]);
    const [homeHtml, postHtml] = await Promise.all([
      homeResponse.text(),
      postResponse.text(),
    ]);

    expect(homeResponse.status).toBe(200);
    expect(homeHtml).toContain("<title>void</title>");
    expect(homeHtml).toContain("在空白处，写下一些东西。");
    expect(homeHtml).toContain('href="/archives/negative-space"');
    expect(homeHtml).toContain("Jul 8, 2026");
    expect(homeHtml).not.toContain("<nav");
    expect(homeHtml).not.toContain('data-diitey-island');
    expect(homeHtml).toContain("pageswap");

    expect(postResponse.status).toBe(200);
    expect(postHtml).toContain("<title>留白不是空白 — void</title>");
    expect(postHtml).toContain('class="back-arrow');
    expect(postHtml).toContain("<span>void</span>");
    expect(postHtml).toContain("留白不是没有内容");
    expect(postHtml).toContain('data-diitey-island="article-scroll-nav"');
    expect(postHtml).toContain("<script");

    const stylesheetPath = homeHtml.match(
      /href="(\/assets\/theme\/styles-[a-f0-9]+\.css)"/,
    )?.[1];
    expect(stylesheetPath).toBeDefined();
    const css = await fetch(`${address}${stylesheetPath}`).then((response) =>
      response.text(),
    );
    expect(css).toContain("prefers-color-scheme:dark");
    expect(css).toContain("text-decoration-color:var(--muted)");
    expect(css).toContain("text-decoration:none");
    expect(css).toContain("border-left-width:2px");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).toContain("72vh");
    expect(css).toContain("scrollbar-width:none");
  }, 15_000);
});

function spawnSite(): SiteProcess {
  const siteRoot = join(import.meta.dir, "..", "templates", "default-site");
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
    { cwd: siteRoot, stdout: "pipe", stderr: "pipe" },
  );
  processes.push(process);
  return process;
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
