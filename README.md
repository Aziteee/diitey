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

打开 `http://127.0.0.1:3000/writing/hello` 即可看到由内容文件、主题集合和主题路由生成的 SSR 页面。访问 `http://127.0.0.1:3000/todos` 可以测试已启用的 todo-list 插件与主题 island。

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

主题和插件引用既可以是站点内的本地源码路径，也可以是已经由 Bun 安装的包名：

```ts
export default defineSite({
  theme: "./themes/local/theme.ts",
  plugins: ["@diitey/plugin-comments"],
});
```

Diitey 不安装、升级或删除扩展包。站点所有者直接维护站点根目录的
`package.json` 和 `bun.lock`，并使用 `bun install` 或 `bun add` 管理扩展及其
额外依赖。本地主题和插件使用的额外依赖同样安装在站点根目录。

仓库的最小站点包含一个 callout 示例插件，可将
`:::callout{type="warning"}` 转换为语义化的静态 `aside`。remark 扩展在
`remark-rehype` 之前执行，rehype 扩展在其后执行；任何转换异常都会使本次
reload 失败并保留原有效快照。

插件也可以声明类型化服务与核心 Action。主题页面用声明式服务绑定在 SSR
期间读取动态数据，主题 island 通过 `/_action/<name>` 提交写操作；核心统一处理
JSON 输入输出校验、64 KiB 全局请求体上限、Origin/CSRF、进程内限流、执行超时
和标准错误响应。

动态数据保存在 `data/site.sqlite`。带数据库结构的插件必须声明稳定 ID、版本、
schema 版本和插件迁移。服务启动会在初始内容快照和 islands 校验成功后、开始
HTTP 监听前自动应用所有待处理迁移；内容 reload 不执行迁移。

核心记录每个已执行迁移的 ID、SQL 校验和与执行时间。全部待处理迁移在同一个
事务中执行；任一迁移失败都会整体回滚并终止启动。已执行迁移被改写，或者数据库
schema 高于当前插件支持版本时，服务启动会明确失败。

最小站点内置了一个包含列表、创建、切换状态和 SQLite 迁移的简单后端示例：
[`plugins/todo-list`](test/fixtures/minimal-site/plugins/todo-list/README.md)。
交互表单仍由主题 island 提供。

## 验证

```bash
bun test
bun run typecheck
```
