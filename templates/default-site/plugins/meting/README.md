# Meting music player

The Meting plugin resolves trusted QQ Music and NetEase Cloud Music song links
for the void theme's WaveformPlayer island.

Use a player in Markdown:

```html
<music-player
  auto="https://y.qq.com/n/yqq/song/001RGrEX3ija5X.html">
</music-player>
```

The island loads when the marker approaches the viewport. It calls two
same-origin public Actions:

- `POST /_action/meting.metadata` with `{ "auto": "..." }` for title, artist,
  album, and artwork;
- `POST /_action/meting.stream` with `{ "source": "tencent", "id": "..." }`
  for the short-lived media URL.

Metadata defaults to a seven-day SQLite cache. Stream URLs default to a
ten-minute cache. Configure the plugin in `site.config.ts` when different
values or authenticated platform cookies are needed:

```ts
{
  use: "./plugins/meting/plugin.ts",
  config: {
    metadataTtlMs: 7 * 24 * 60 * 60 * 1_000,
    streamTtlMs: 10 * 60 * 1_000,
    defaultBitrate: 320,
    tencentCookie: process.env.TENCENT_MUSIC_COOKIE ?? "",
    neteaseCookie: process.env.NETEASE_MUSIC_COOKIE ?? "",
  },
}
```

Only strict `y.qq.com` and `music.163.com` single-song URLs are accepted.
Cookies stay on the server and are never included in Action output.
