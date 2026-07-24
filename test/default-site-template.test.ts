import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

const processes: SiteProcess[] = [];

afterEach(async () => {
  for (const process of processes) process.kill();
  await Promise.all(processes.splice(0).map((process) => process.exited));
});

test("the default site template serves its home, archives, notes, and article pages", async () => {
  const process = spawnSite();
  const address = await readServerAddress(process);
  const [home, archives, notes, article] = await Promise.all([
    fetch(address),
    fetch(`${address}/archives`),
    fetch(`${address}/notes`),
    fetch(`${address}/archives/negative-space`),
  ]);
  const [homeHtml, archivesHtml, notesHtml, articleHtml] = await Promise.all([
    home.text(),
    archives.text(),
    notes.text(),
    article.text(),
  ]);

  expect(home.status).toBe(200);
  expect(homeHtml).toContain('href="/archives/negative-space"');
  expect(homeHtml).toContain("Notes");
  expect(homeHtml).toContain("傍晚窗外有一点风");
  expect(homeHtml).toContain('href="/notes"');
  expect(homeHtml).not.toContain("第二杯咖啡之后");
  expect(archives.status).toBe(200);
  expect(archivesHtml).toContain('href="/archives/negative-space"');
  expect(archivesHtml).toContain("Writing");
  expect(archivesHtml).toContain("2026");
  expect(archivesHtml).toMatch(/Jul 8/);
  expect(archivesHtml).not.toMatch(/Jul 8, 2026/);
  expect(notes.status).toBe(200);
  expect(notesHtml).toContain("Notes");
  expect(notesHtml).toContain("第二杯咖啡之后");
  expect(article.status).toBe(200);
  expect(articleHtml).toContain('data-diitey-island="article-scroll-nav"');
}, 15_000);

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
    const match = output.match(/Listening on (https?:\/\/[^\s"]+)/);
    if (match?.[1]) return match[1];
  }
}
