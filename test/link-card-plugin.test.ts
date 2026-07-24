import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContentRecord } from "../src/content.ts";
import {
  createLinkCardDefinition,
  isPublicHttpUrl,
  languageColor,
  matchGithubRepo,
  matchYoutubeVideo,
  normalizeUrl,
  parseOpenGraph,
  renderLinkCardHtml,
  type FetchLike,
} from "../templates/default-site/plugins/link-card/plugin.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("link-card helpers", () => {
  test("normalizes urls and rejects non-public targets", () => {
    expect(normalizeUrl("https://Example.com/path/?q=1#hash")).toBe(
      "https://example.com/path?q=1",
    );
    expect(isPublicHttpUrl("https://example.com")).toBe(true);
    expect(isPublicHttpUrl("http://127.0.0.1/")).toBe(false);
    expect(isPublicHttpUrl("http://192.168.1.1/")).toBe(false);
    expect(isPublicHttpUrl("http://localhost/")).toBe(false);
  });

  test("matches github repository urls only", () => {
    expect(matchGithubRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(matchGithubRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(matchGithubRepo("https://github.com/owner/repo/issues/1")).toBe(
      null,
    );
  });

  test("matches youtube watch, short, embed, and shorts urls", () => {
    expect(matchYoutubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(
      { videoId: "dQw4w9WgXcQ" },
    );
    expect(matchYoutubeVideo("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
    });
    expect(matchYoutubeVideo("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual(
      { videoId: "dQw4w9WgXcQ" },
    );
    expect(matchYoutubeVideo("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual(
      { videoId: "dQw4w9WgXcQ" },
    );
    expect(matchYoutubeVideo("https://www.youtube.com/watch?v=bad")).toBe(null);
    expect(matchYoutubeVideo("https://example.com/watch?v=dQw4w9WgXcQ")).toBe(
      null,
    );
  });

  test("parses open graph metadata", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello &amp; World" />
        <meta property="og:description" content="A page" />
        <meta property="og:image" content="/img.png" />
        <meta property="og:site_name" content="Example" />
        <title>Fallback</title>
      </head></html>
    `;
    const meta = parseOpenGraph(html, "https://example.com/post");
    expect(meta.title).toBe("Hello & World");
    expect(meta.description).toBe("A page");
    expect(meta.image).toBe("https://example.com/img.png");
    expect(meta.siteName).toBe("Example");
  });

  test("renders static card html", () => {
    const html = renderLinkCardHtml({
      url: "https://example.com",
      title: "Example",
      description: "Desc",
      image: "https://example.com/a.png",
      siteName: "Example",
      provider: null,
      extras: {},
      degraded: false,
    });
    expect(html).toContain('class="link-card"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("Example");
    expect(html).toContain("Desc");
  });

  test("maps known language colors and falls back for unknowns", () => {
    expect(languageColor("TypeScript")).toBe("#3178c6");
    expect(languageColor("MadeUpLang")).toBe("#8b949e");
  });
});

describe("link-card plugin", () => {
  test("resolves generic html once and reuses file cache", async () => {
    const cachePath = await tempCachePath();
    let hits = 0;
    const fetchImpl: FetchLike = async (input) => {
      hits += 1;
      expect(String(input)).toBe("https://example.com/article");
      return new Response(
        `<html><head>
          <meta property="og:title" content="Article" />
          <meta property="og:description" content="Body" />
          <meta property="og:site_name" content="Example" />
        </head></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    };

    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const first = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/article"}\n:::`,
    );
    const second = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/article"}\n:::`,
    );

    expect(hits).toBe(1);
    expect(first).toContain('class="link-card"');
    expect(first).toContain("Article");
    expect(first).toContain("Body");
    expect(second).toContain("Article");
  });

  test("applies author overrides and github provider extras", async () => {
    const cachePath = await tempCachePath();
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/repos/")) {
        return Response.json({
          full_name: "owner/repo",
          description: "A repo",
          html_url: "https://github.com/owner/repo",
          language: "TypeScript",
          stargazers_count: 42,
          forks_count: 3,
          owner: { avatar_url: "https://avatars.example/o.png" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const html = await renderMarkdown(
      definition,
      `:::link-card{url="https://github.com/owner/repo" title="My title"}\n:::`,
    );
    expect(html).toContain("My title");
    expect(html).toContain('data-provider="github"');
    expect(html).toContain('data-key="stars"');
    expect(html).toContain("link-card__icon");
    expect(html).toContain("link-card__lang-dot");
    expect(html).toContain("background:#3178c6");
    expect(html).toContain("42");
    expect(html).toContain("TypeScript");
  });

  test("degrades when fetch fails and no cache exists", async () => {
    const cachePath = await tempCachePath();
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };
    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const html = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/missing"}\n:::`,
    );
    expect(html).toContain("link-card--degraded");
    expect(html).toContain("example.com");
  });

  test("refresh re-fetches and failed refresh keeps stale success cache", async () => {
    const cachePath = await tempCachePath();
    let mode: "ok" | "fail" = "ok";
    let hits = 0;
    const fetchImpl: FetchLike = async () => {
      hits += 1;
      if (mode === "fail") throw new Error("boom");
      return new Response(
        `<html><head><meta property="og:title" content="V${hits}" /></head></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    };
    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const first = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/x"}\n:::`,
    );
    expect(first).toContain("V1");

    const refreshed = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/x" refresh="true"}\n:::`,
    );
    expect(refreshed).toContain("V2");
    expect(hits).toBe(2);

    mode = "fail";
    const afterFail = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/x" refresh="true"}\n:::`,
    );
    expect(afterFail).toContain("V2");
    expect(hits).toBe(3);
  });

  test("resolves youtube via oembed with author extras", async () => {
    const cachePath = await tempCachePath();
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      expect(url).toContain("youtube.com/oembed");
      expect(url).toContain(encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
      return Response.json({
        title: "Never Gonna Give You Up",
        author_name: "Rick Astley",
        thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        provider_name: "YouTube",
      });
    };

    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const html = await renderMarkdown(
      definition,
      `:::link-card{url="https://youtu.be/dQw4w9WgXcQ"}\n:::`,
    );
    expect(html).toContain('data-provider="youtube"');
    expect(html).toContain("Never Gonna Give You Up");
    expect(html).toContain("Rick Astley");
    expect(html).toContain("i.ytimg.com");
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('data-key="author"');
  });

  test("youtube falls back to generic when oembed fails", async () => {
    const cachePath = await tempCachePath();
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes("oembed")) {
        return new Response("nope", { status: 404 });
      }
      if (url.includes("youtube.com/watch")) {
        return new Response(
          `<html><head>
            <meta property="og:title" content="OG Title" />
            <meta property="og:site_name" content="YouTube" />
          </head></html>`,
          {
            status: 200,
            headers: { "content-type": "text/html" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const html = await renderMarkdown(
      definition,
      `:::link-card{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}\n:::`,
    );
    expect(html).toContain("OG Title");
    expect(html).not.toContain('data-provider="youtube"');
  });

  test("blocks private redirect targets", async () => {
    const cachePath = await tempCachePath();
    const fetchImpl: FetchLike = async (input) => {
      if (String(input) === "https://example.com/go") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error(`should not follow ${input}`);
    };
    const definition = createLinkCardDefinition(
      {
        fetchTimeoutMs: 5_000,
        maxRedirects: 3,
        maxBodyBytes: 100_000,
        userAgent: "test",
        githubToken: "",
      },
      { fetch: fetchImpl, cachePath },
    );

    const html = await renderMarkdown(
      definition,
      `:::link-card{url="https://example.com/go"}\n:::`,
    );
    expect(html).toContain("link-card--degraded");
  });
});

async function renderMarkdown(
  definition: ReturnType<typeof createLinkCardDefinition>,
  body: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "link-card-md-"));
  temporaryRoots.push(root);
  const filePath = join(root, "page.md");
  await Bun.write(
    filePath,
    `---
id: "page"
created: "2026-07-24"
---

${body}
`,
  );
  const record = await buildContentRecord(filePath, "page.md", {
    remarkPlugins: definition.markdown?.remarkPlugins ?? [],
    rehypePlugins: [],
  });
  return record.html;
}

async function tempCachePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "link-card-cache-"));
  temporaryRoots.push(root);
  return join(root, "cache.sqlite");
}
