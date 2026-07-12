# Diitey

Diitey 是一个以 Markdown 文件为内容真相、由主题解释网站结构的个人站点系统。

## 本地运行

安装依赖：

```bash
bun install
```

使用仓库内的最小站点启动服务：

```bash
bun index.ts start --root test/fixtures/minimal-site --port 3000
```

打开 `http://127.0.0.1:3000/writing/hello` 即可看到由内容文件、主题集合和主题路由生成的 SSR 页面。

修改内容文件后，可在另一个终端中重建有效快照并查看状态：

```bash
bun index.ts reload --root test/fixtures/minimal-site
bun index.ts status --root test/fixtures/minimal-site
```

`start` 会在站点的 `data/diitey.runtime.json` 写入仅当前用户可读的管理连接信息，并在正常退出时删除。管理监听器仅绑定 loopback；`reload` 成功后原子替换有效快照，校验失败或超时则保留原有效快照。

主题可用 glob 声明集合，通过 `where`、`orderBy`、`limit` 和 `paginate` 查询内容，并用源路径参数生成内容路由。集合排序会自动追加内容 ID 升序作为最终排序键；分页读取正整数 `page` 查询参数。内容记录的 `url` 始终指向其 canonical 路由。

可在 `site.config.ts` 中设置 reload 构建超时：

```ts
export default defineSite({
  theme: "./themes/minimal/theme.ts",
  reload: { timeoutMs: 30_000 },
});
```

插件可以按配置顺序声明静态 Markdown 扩展：

```ts
export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/callout/plugin.ts"],
});
```

仓库的最小站点包含一个 callout 示例插件，可将
`:::callout{type="warning"}` 转换为语义化的静态 `aside`。remark 扩展在
`remark-rehype` 之前执行，rehype 扩展在其后执行；任何转换异常都会使本次
reload 失败并保留原有效快照。

## 验证

```bash
bun test
bun run typecheck
```
