import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPublication } from "../src/publication/runtime.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("plugin publication assets are served and head fragments are fixed at startup", async () => {
  const root = await fixture();
  const assetPath = join(root, "plugins", "assets", "font.woff2");
  await writeFile(assetPath, "first font");

  const publication = await openPublication({ root });
  try {
    const page = await publication.handle(new Request("http://example.test/writing/hello"));
    const html = await page.text();
    expect(html).toContain('<meta name="plugin-assets" content="on">');
    expect(html.indexOf('name="plugin-assets"')).toBeLessThan(html.indexOf("</head>"));
    const assetUrl = html.match(/\/assets\/plugins\/assets\/font-asset/)?.[0];
    expect(assetUrl).toBeDefined();

    const response = await publication.handle(new Request(`http://example.test${assetUrl}`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("first font");
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    await writeFile(assetPath, "second font");
    expect((await publication.reload()).status).toBe("succeeded");
    expect(await publication.handle(new Request(`http://example.test${assetUrl}`)).then((r) => r.text())).toBe("first font");
  } finally {
    await publication.close();
  }
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".plugin-assets-"));
  roots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, { recursive: true });
  await mkdir(join(root, "plugins", "assets"), { recursive: true });
  await writeFile(
    join(root, "plugins", "assets", "plugin.ts"),
    `import { definePlugin } from "diitey";
export default definePlugin({
  id: "assets",
  publication: {
    assets: [{ name: "font-asset", file: "./font.woff2" }],
    head: ({ assetUrl }) => '<meta name="plugin-assets" content="on"><link rel="preload" href="' + assetUrl("font-asset") + '">',
  },
});
`,
  );
  const configPath = join(root, "site.config.ts");
  const config = await Bun.file(configPath).text();
  await writeFile(configPath, config.replace("  plugins: [", "  plugins: [\n    \"./plugins/assets/plugin.ts\","));
  return root;
}
