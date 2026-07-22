# 插件开发

插件为 Diitey 提供服务端能力。它可以转换 Markdown、声明类型化服务和受控 Action、管理 SQLite 结构、为发布页提供插件发布资源与 head 片段，并在核心管理界面中提供一个可选管理页。

插件不拥有发布路由、页面布局或发布侧 island。需要公开交互时，由主题渲染 island，再调用插件 Action；插件的浏览器组件例外仅限受鉴权的 `/_admin` 管理界面。

> 主题和插件是站点所有者选择的可信本地代码，与核心运行在同一 Bun 进程中，不受安全沙箱隔离。不要加载不可信插件。

## 目录示例

```text
plugins/comments/
├── plugin.ts       # 默认导出插件定义
├── admin.tsx       # 可选管理页组件
├── admin.css       # 可选管理页样式
└── assets/         # 可选发布资源
```

最小插件：

```ts
// plugins/example/plugin.ts
import { definePlugin } from "diitey";

export default definePlugin({
  id: "example",
  name: "Example",
  version: "1.0.0",
});
```

在站点中启用：

```ts
// site.config.ts
import { defineSite } from "diitey";

export default defineSite({
  theme: "./themes/my-theme/theme.ts",
  plugins: [
    "./plugins/example/plugin.ts",
    { use: "@example/diitey-plugin", config: { enabled: true } },
  ],
});
```

插件按 `plugins` 中的顺序加载。服务名和 public Action 名在整个站点内必须唯一，建议使用 `<plugin>.<operation>` 命名，例如 `comments.list`。

## 插件配置

插件可以用任何带 `parse(value)` 方法的 schema；通常使用 Zod：

```ts
import { definePlugin } from "diitey";
import { z } from "zod";

const configSchema = z
  .object({
    maxLength: z.number().int().positive().max(10_000),
  })
  .strict()
  .default({ maxLength: 1_000 });

export default definePlugin({
  config: configSchema,
  setup(config) {
    const input = z.object({
      text: z.string().max(config.maxLength),
    }).strict();

    return {
      id: "example",
      version: "1.0.0",
      services: {
        "example.echo": {
          input,
          output: z.object({ text: z.string() }).strict(),
          handler(value) {
            return value;
          },
        },
      },
    };
  },
});
```

站点未提供 `config` 时，核心会把 `undefined` 交给 schema。若插件应支持零配置，请给整个 schema 设置默认值。

`setup` 会分别在主进程和内容快照 worker 的启动阶段执行。它必须是确定、无外部副作用的定义工厂：不要在其中迁移数据库、启动定时器、发送请求或写文件。数据库结构变更放在迁移中，运行期写入放在服务 handler 中；准备内容目录（例如 `git pull`）放在内容快照前阶段。

插件配置和定义属于站点程序，修改后必须重启。

## 内容快照前阶段

插件可声明 `beforeContentSnapshot`，在**每次**构建内容快照、扫描内容目录之前由核心调用（`start` 首次快照与每次 `reload` 相同）。多个插件按 `site.config` 的 `plugins` 顺序串行执行；任一抛错会使本次快照构建失败（`start` 无法启动；`reload` 保留原有效发布视图）。

```ts
export default definePlugin({
  id: "git-sync",
  async beforeContentSnapshot({ contentRoot, signal, log }) {
    // contentRoot: 已解析的内容目录真实路径
    // signal: 与本次构建 / reload 超时对齐；应响应 abort
    // log: 插件日志口
    log.info("syncing content directory");
    // …对 contentRoot 执行准备（如 git pull）
  },
});
```

该阶段只用于准备内容目录上的文件状态，不产生内容记录，也不进入有效发布视图。不要用它改主题、插件列表或站点程序；也不要依赖数据库或已加载内容。网络类准备会占用 `reload.timeoutMs`，且在内容快照 worker 进程中执行，部署时需保证该进程能使用相同工具与凭据。

## Markdown 扩展

插件可以在三个阶段扩展内容构建：

```ts
export default definePlugin({
  name: "markdown-example",
  markdown: {
    bodyTransforms: [transformBody],
    remarkPlugins: [remarkExample],
    rehypePlugins: [rehypeExample],
  },
});
```

执行顺序为：

1. 解析 YAML Front Matter，并把原始 Markdown 正文依次交给 `bodyTransforms`；
2. `remark-parse`、front matter、GFM 和内容资源改写；
3. 按站点插件顺序执行 `remarkPlugins`；
4. `remark-rehype`；
5. 按站点插件顺序执行 `rehypePlugins`；
6. 输出 HTML。

### 正文转换

`bodyTransforms` 只接收 Front Matter 之后的正文，适合必须在 Markdown 解析之前完成的文本级处理：

```ts
import type { MarkdownBodyTransform } from "diitey";

const transformBody: MarkdownBodyTransform = (body, context) => {
  // context.sourcePath：相对内容目录、使用 / 的路径
  // context.filePath：磁盘绝对路径
  // context.attributes：只读 Front Matter
  return body.replaceAll("OLD_TOKEN", "NEW_TOKEN");
};
```

转换可异步执行，但必须返回字符串。不要用简单文本替换处理能够由 Markdown AST 准确表达的结构。

### remark 与 rehype

remark 插件处理 Markdown AST，rehype 插件处理 HTML AST。一个 directive 插件可以先在 remark 阶段产生语义节点，再在 rehype 阶段输出静态标记：

```ts
import { definePlugin } from "diitey";
import remarkDirective from "remark-directive";

export default definePlugin({
  name: "callout",
  markdown: {
    remarkPlugins: [remarkDirective, remarkCallout],
    rehypePlugins: [rehypeCallout],
  },
});
```

Markdown 扩展只产生静态 HTML，不携带发布侧浏览器组件。视觉样式仍由主题负责。任一转换抛错都会使启动或当前 reload 失败，并保留上一份有效发布视图。

完整示例见 [`test/fixtures/minimal-site/plugins/callout/plugin.ts`](../test/fixtures/minimal-site/plugins/callout/plugin.ts)。

## 类型化服务

服务是主题与插件动态能力交互的服务端边界。每个服务都声明输入、输出和 handler：

```ts
import { definePlugin, PluginNotFoundError } from "diitey";
import { z } from "zod";

const input = z.object({ id: z.number().int().positive() }).strict();
const output = z.object({
  id: z.number(),
  title: z.string(),
}).strict();

export default definePlugin({
  id: "todo",
  version: "1.0.0",
  services: {
    "todo.get": {
      input,
      output,
      handler(value, { database, signal, log, content, requestMeta }) {
        if (signal.aborted) throw signal.reason;

        const row = database
          .query<{ id: number; title: string }, [number]>(
            "SELECT id, title FROM todo_items WHERE id = ?",
          )
          .get(value.id);

        if (!row) throw new PluginNotFoundError("Todo does not exist");
        log.info(`loaded todo ${value.id}`);
        return row;
      },
    },
  },
});
```

handler 上下文包含：

| 字段 | 作用 |
| --- | --- |
| `database` | 站点 `data/site.sqlite` 的 Bun SQLite 连接；按需访问 |
| `signal` | Action 或 SSR 服务的超时 / 取消信号 |
| `log` | 带插件 ID 的 `info`、`warn`、`error` 日志接口 |
| `content.exists(id)` | 判断当前有效发布视图中是否存在内容 ID |
| `content.get(id)` | 读取不含正文 HTML 的只读 `ContentSummary` |
| `call(name, input)` | 进程内调用另一已注册插件服务（返回 Promise）；不转发 `requestMeta`，有深度上限；未知服务抛错 |
| `requestMeta` | 仅 public Action 顶层调用时可用；嵌套 `call` 不注入 |

输入会在 handler 前解析，输出会在 handler 后解析。不要返回无法通过输出 schema 的值。服务输出可为 JSON 可表达的数组、对象、字符串、数字、布尔值或 `null`，管理页数据还必须可 JSON 序列化。

`PluginNotFoundError` 经 Action 暴露为通用 404；其他未处理异常会记录详细服务端日志，并向浏览器返回不泄露内部信息的 500。

### 主题 SSR 调用

主题页面通过服务绑定读取动态数据：

```ts
route(
  "/todos",
  page("todos", {
    items: { service: "todo.list", input: {} },
  }),
)
```

服务绑定只在服务端执行，不会把服务本身暴露给浏览器。详见[主题开发：服务绑定](theme-development.md#服务绑定)。

## public Action

Action 把一个插件服务暴露为核心控制的 JSON POST 入口：

```ts
actions: {
  "todo.create": {
    service: "todo.create",
    bodyLimitBytes: 512,
    rateLimit: { limit: 20, windowMs: 60_000 },
    timeoutMs: 2_000,
  },
},
```

主题 island 调用：

```ts
const response = await fetch("/_action/todo.create", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "写一篇文章" }),
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.error ?? `Action failed (${response.status})`);
}

const created = await response.json();
```

核心统一执行：

- 仅允许 `POST application/json`；
- 要求请求 `Origin` 与站点 origin 完全一致；
- 解析服务输入并校验服务输出；
- 默认请求体上限 64 KiB，单个 Action 可调小但不能超过 64 KiB；
- 默认每客户端、每 Action 每分钟 60 次进程内限流；
- 默认 5 秒超时；
- 成功返回 JSON 和 HTTP 201；
- 输入错误返回 400，不存在返回 404，超限返回 413 / 429。

从 curl 等非浏览器客户端调用时也必须显式发送正确的 `Origin` 头。

### Cookie 与 CSRF

若 Action 依赖发布站点 cookie，声明：

```ts
credentials: "cookie"
```

核心会在发布 HTML 响应中设置 `diitey_csrf` cookie。浏览器请求必须把同一值放进 `x-csrf-token` 请求头；否则返回 403。没有 cookie 依赖的 Action 不要声明此项。

## SQLite 与迁移

插件动态数据保存在站点 `data/site.sqlite`。需要数据库结构的插件必须声明稳定的 `id`、插件 `version`、非负整数 `schemaVersion` 和完整迁移历史：

```ts
export default definePlugin({
  id: "todo-list",
  version: "1.1.0",
  schemaVersion: 2,
  migrations: [
    {
      id: "0001-create-items",
      schemaVersion: 1,
      sql: `
        CREATE TABLE todo_list_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0
        );
      `,
    },
    {
      id: "0002-add-created-at",
      schemaVersion: 2,
      sql: `
        ALTER TABLE todo_list_items ADD COLUMN created_at TEXT;
      `,
    },
  ],
});
```

规则：

- 迁移 `schemaVersion` 必须严格递增，最后一条等于插件 `schemaVersion`；
- 迁移 ID 在插件内唯一，一经发布不要改名或删除；
- 已执行迁移的 SQL 校验和不能变化；修复结构必须新增迁移；
- 数据库版本高于当前插件支持版本时，启动会失败；
- 所有插件的待执行迁移在同一个事务中运行，任一失败则整体回滚；
- 迁移只在启动时、开始 HTTP 监听前执行，内容 reload 不执行迁移。

`schemaVersion: 0` 表示插件参与数据库版本追踪但当前没有迁移；此时 `migrations` 应为空。

避免使用通用表名。推荐给表和索引加插件前缀，因为插件共享同一个 SQLite 数据库，代码可信边界并不提供数据库隔离。

完整后端示例见 [`test/fixtures/minimal-site/plugins/todo-list`](../test/fixtures/minimal-site/plugins/todo-list/)。

## 管理页与 admin Action

插件可以在核心拥有的 `/_admin` 中声明至多一个管理页：

```ts
export default definePlugin({
  id: "comments",
  version: "1.0.0",
  adminPage: {
    component: "./admin.tsx",
    title: "Comments",
    dataService: "comments.adminList",
    styles: "admin",
  },
  services: {
    "comments.adminList": {
      input: z.object({}).strict(),
      output: adminDataSchema,
      handler(_input, context) {
        return loadAdminData(context.database);
      },
    },
    "comments.delete": {
      input: z.object({ id: z.number().int().positive() }).strict(),
      output: z.object({ deleted: z.number().int() }).strict(),
      handler(input, { database }) {
        const result = database.query("DELETE FROM comments WHERE id = ?").run(input.id);
        return { deleted: Number(result.changes) };
      },
    },
  },
  actions: {
    delete: {
      service: "comments.delete",
      access: "admin",
    },
  },
});
```

约定：

- 插件必须有显式 `id`，格式为 `/^[a-z0-9][a-z0-9_-]*$/`；
- `login`、`logout`、`action`、`assets` 是保留 ID；
- 管理页 URL 固定为 `/_admin/<plugin-id>`，插件不能自定义路由；
- `component` 相对插件入口解析；组件默认导出并接收 `{ data }`；
- `dataService` 可选，其输入 schema 必须接受 `{}`；核心在 SSR 时调用并把输出作为 `data`；
- `styles: "admin"` 对应插件入口旁的 `admin.css`，只在该插件页挂载；
- admin Action 名也必须符合插件 ID 的字符格式，URL 为 `/_admin/action/<plugin-id>/<action-name>`。

启用管理界面：

```bash
bun index.ts start \
  --root path/to/site \
  --admin-token "replace-with-at-least-32-bytes"
```

打开 `http://127.0.0.1:3000/_admin`，使用同一 token 登录。未配置 token 时，整个 `/_admin` 命名空间返回 404，管理组件与资源也不会构建。

非 loopback 部署启用 admin 时，必须设置外部 HTTPS origin：

```bash
DIITEY_ADMIN_TOKEN="..." \
DIITEY_PUBLIC_ORIGIN="https://example.com" \
bun index.ts start --root path/to/site --host 0.0.0.0
```

admin Action 要求有效会话、同源请求和 CSRF 头。管理组件可以读取 `diitey_csrf` cookie：

```ts
const csrf = document.cookie
  .split("; ")
  .find((part) => part.startsWith("diitey_csrf="))
  ?.split("=")[1];

await fetch("/_admin/action/comments/delete", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-csrf-token": decodeURIComponent(csrf ?? ""),
  },
  body: JSON.stringify({ id: 1 }),
});
```

参考实现见 [`templates/default-site/plugins/comments`](../templates/default-site/plugins/comments/)。

## 插件发布资源与 head 片段

Markdown 扩展若需要字体、CSS、预加载提示或 meta，可声明插件自带资源和 head HTML：

```ts
export default definePlugin({
  id: "thuum",
  publication: {
    assets: [
      {
        name: "font",
        file: "./assets/thuum.woff2",
        contentType: "font/woff2",
      },
    ],
    head({ assetUrl }) {
      const font = assetUrl("font");
      return `<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>`;
    },
  },
});
```

资源文件必须位于插件入口目录的真实路径树内，资源名不能包含 `/` 或 `\\`。插件必须声明合法 `id`。核心在启动时复制并固定资源，URL 位于 `/assets/plugins/<plugin-id>/<asset-name>`。

`head` 在启动时执行一次，`assetUrl(name)` 只能引用同一插件已声明的资源。各插件片段按 `site.config.ts` 中的顺序插入最终 `</head>` 前。它是可信本地代码的任意 HTML，但只能通过这一接口贡献 head，不能修改 body 或替换 document。

资源和 head 修改后必须重启，内容 reload 不会重新构建它们。

## 发布插件包

插件入口需要默认导出 `definePlugin(...)` 的结果。包中应包含运行时需要的管理组件、CSS 与资源文件，并在 `package.json` 中正确声明依赖。站点通过包名选择：

```ts
plugins: [
  {
    use: "@example/diitey-plugin-comments",
    config: { maxLength: 2000 },
  },
]
```

Diitey 不安装、升级或删除插件。站点所有者使用 `bun add`、`bun install` 和 lockfile 管理包与额外依赖。

## 开发与排错

插件代码、配置、迁移、管理页、CSS 和发布资源都在启动时固定。修改后重启：

```bash
bun index.ts start --root path/to/site --port 3000
```

只有验证 Markdown 内容变化时才使用：

```bash
bun index.ts reload --root path/to/site
bun index.ts status --root path/to/site
```

提交插件前至少检查：

- 配置 schema 对 `undefined` 的行为符合预期；
- `setup` 确定且无外部副作用；
- `beforeContentSnapshot` 只准备内容目录，并响应 `signal`；
- 服务名和 public Action 名带插件前缀且全站唯一；
- 所有服务同时校验输入和输出，并响应 `signal`；
- Action 使用尽可能小的请求体、限流和超时上限；
- 表名带插件前缀，迁移历史只追加不改写；
- public Action 不泄露内部错误，敏感操作使用 admin Action；
- 管理组件和 island props 中不放 token、秘密或不必要的个人数据；
- 发布资源留在插件目录内，head 片段只包含确有必要的标记；
- `bun test` 与 `bun run typecheck` 通过。
