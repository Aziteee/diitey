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

站点名、简介、文档语言和列表数量位于 `site.config.ts`：

- `homePosts` / `homeNotes`：主页 Writing / Notes 展示条数
- `postsPerPage` / `notesPerPage`：`/archives` 与 `/notes` 每页条数

- 长文放在 `content/posts/`，每个文件必须声明 `id`、`created` 和 `title`；设置 `draft: true` 可使其不被发布。
- 短笔记放在 `content/notes/`，只需 `id` 和 `created`（无需标题）；完整列表在 `/notes`。
