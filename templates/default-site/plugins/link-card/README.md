# link-card

Content-snapshot Markdown extension that turns declared URLs into static link cards.

## Syntax

```md
:::link-card{url="https://example.com"}
:::

:::link-card{url="https://github.com/owner/repo" title="Override title"}
:::

:::link-card{url="https://example.com" refresh="true"}
:::
```

Optional attributes: `title`, `description`, `image`, `siteName`, `provider` (`github` | `generic`), `refresh`.

## Behavior

- Resolves at content snapshot time (build / reload), not per request.
- Generic pages: Open Graph / Twitter / `<title>` metadata.
- GitHub repository URLs use the GitHub API when available, otherwise fall back to generic fetch.
- Successful results are cached under `data/link-card-cache.sqlite` (never expire). `refresh` forces a re-fetch; on failure the last successful cache entry is kept.
- Fetch failures without cache degrade to a skeleton card (hostname as title); the snapshot still succeeds.
- Outbound requests only allow public `http(s)` targets (no localhost / private IPs), with redirect, timeout, and body size limits.
- Preview images stay hot-linked.

## Config (`site.config.ts`)

```ts
{
  use: "./plugins/link-card/plugin.ts",
  config: {
    // cachePath?: string
    // fetchTimeoutMs?: number  // default 8000
    // maxRedirects?: number    // default 5
    // maxBodyBytes?: number    // default 512000
    // userAgent?: string
    // githubToken?: string     // optional, higher GitHub API quota
  },
}
```

Theme styles target `.link-card` (void theme includes styles).
