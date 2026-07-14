# void

Diitey 的默认站点模板。它使用纯服务端渲染的 `void` 主题：无导航栏、无客户端脚本，并跟随系统自动选择深浅色外观。

进入模板目录并启动：

```bash
cd templates/default-site
bun install
bun run start -- --port 3000
```

打开 `http://127.0.0.1:3000`。修改内容后可运行：

```bash
bun run reload
```

站点名、简介、文档语言和每页数量位于 `site.config.ts`。内容文件放在 `content/posts/`，每个文件必须声明 `id`、`created` 和 `title`；设置 `draft: true` 可使其不被发布。
