# 主题开发

主题是 Diitey 中站点信息架构与页面呈现的所有者。它声明“哪些内容组成集合、内容发布到哪些 URL、页面需要什么数据”，并用 Preact 渲染 HTML；需要浏览器交互时，再用 island 局部增强。

主题不修改内容文件，也不直接操作插件数据库。动态数据通过插件服务读取，写操作由主题 island 调用插件 Action。

## 目录约定

一个主题至少包含入口文件和页面目录：

```text
themes/my-theme/
├── theme.ts
├── styles.css              # 可选；由 theme.ts 的 styles 声明
├── pages/
│   ├── document.tsx        # 可选；由 document 声明
│   ├── home.tsx
│   ├── post.tsx
│   ├── not-found.tsx       # 可选；route("*", page("not-found", {}))
│   └── archives.tsx
├── islands/                # 可选；顶层 .ts/.tsx 文件会被构建
│   └── counter.tsx
└── shared/                 # 可选；普通共享模块
```

`page("post", ...)` 对应 `pages/post.tsx`。页面和 document 必须默认导出 Preact 组件。`styles: "styles"` 对应主题入口旁的 `styles.css`。

## 最小主题

```ts
// themes/my-theme/theme.ts
import { collection, defineTheme, page, route } from "diitey";

export default defineTheme({
  collections: {
    posts: collection({
      from: "posts/*.md",
      schema: { title: "string", draft: "boolean?" },
      where: { draft: { not: true } },
      orderBy: [{ field: "created", direction: "desc" }],
    }),
  },
  routes: [
    route(
      "/",
      page("home", {
        posts: { collection: "posts", limit: 10 },
      }),
    ),
    route(
      "/posts/:slug",
      page("post", {
        post: { collection: "posts", match: "posts/:slug.md" },
      }),
    ),
  ],
});
```

```tsx
// themes/my-theme/pages/post.tsx
import type { ContentRecord } from "diitey";

export default function Post({ post }: { post: ContentRecord }) {
  return (
    <main>
      <h1>{String(post.attributes.title)}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
    </main>
  );
}
```

在站点中启用：

```ts
// site.config.ts
import { defineSite } from "diitey";

export default defineSite({
  theme: "./themes/my-theme/theme.ts",
});
```

## 可配置主题

主题可以用任何带 `parse(value)` 方法的 schema；项目通常使用 Zod。核心在启动时解析配置，再调用一次 `setup` 形成主题定义。

```ts
import { collection, defineTheme, page, route } from "diitey";
import { z } from "zod";

const configSchema = z
  .object({
    siteName: z.string().min(1),
    pageSize: z.number().int().positive().max(100),
  })
  .strict()
  .default({ siteName: "My Site", pageSize: 10 });

export type ThemeConfig = z.infer<typeof configSchema>;

export default defineTheme({
  config: configSchema,
  setup(config) {
    return {
      document: "document",
      styles: "styles",
      collections: {
        posts: collection({
          from: "posts/**/*.md",
          schema: { title: "string" },
        }),
      },
      routes: [
        route(
          "/",
          page("home", {
            posts: { collection: "posts", paginate: config.pageSize },
          }),
        ),
      ],
    };
  },
});
```

站点配置可以传入：

```ts
theme: {
  use: "./themes/my-theme/theme.ts",
  config: { siteName: "Notes", pageSize: 12 },
},
```

未提供 `config` 时，核心把 `undefined` 交给 schema。若希望主题无需配置即可运行，需要给整个 schema 设置默认值，而不只是给对象字段设置默认值。

`setup` 会分别在主进程和内容快照 worker 的启动阶段执行，因此必须是确定、无外部副作用的定义工厂。主题配置属于站点程序，修改后需要重启。

## 集合

集合从内容目录中选择内容记录，并校验主题所依赖的属性。

```ts
collection({
  from: "posts/**/*.md",
  schema: {
    title: "string",
    tags: "string[]?",
    draft: "boolean?",
    rating: "number?",
  },
  where: {
    draft: { not: true },
    tags: { contains: "typescript" },
  },
  orderBy: [
    { field: "created", direction: "desc" },
    { field: "title", direction: "asc" },
  ],
})
```

### `from`

`from` 是相对内容目录的 picomatch glob。支持 `*`、`**`、`?`、字符集合和 brace pattern。源路径统一使用 `/`；Windows 路径也会自动归一化。

Diitey 当前只扫描 `.md` 文件，因此 glob 即使写了其他扩展，也只会命中已扫描的 Markdown 内容文件。

### `schema`

可用类型为：

| 类型 | 含义 |
| --- | --- |
| `string` / `string?` | 必填 / 可选字符串 |
| `string[]` / `string[]?` | 必填 / 可选字符串数组 |
| `boolean` / `boolean?` | 必填 / 可选布尔值 |
| `number` / `number?` | 必填 / 可选数字 |

`id` 与 `created` 是每个内容文件的核心必填字段，不必重复写入 schema。集合校验失败会使启动或本次 reload 失败。

### `where`

过滤条件可以是精确值，也可以使用：

```ts
where: {
  draft: { not: true },       // 不等于
  tags: { contains: "web" },  // 数组包含
  cover: { exists: true },     // 字段存在
}
```

### `orderBy`

可按 `id`、`created` 或 Front Matter 标量字段排序。字段值必须是相容的字符串、数字或布尔值；缺失值排在已定义值之后。核心始终追加内容 ID 升序作为最终稳定排序键。

## 路由与数据绑定

`route(path, page, options?)` 把 URL 模式映射到一个页面定义。路径必须以 `/` 开头，不能占用 `/assets`；参数写作 `:name`。

特殊路径 `*` 表示主题自定义的 **not-found** 页面：在公开 HTML 导航未命中任何已发布路由、且站点 `public/` 也未提供该文件时，用该页面响应，HTTP 状态固定为 **404**。每个主题最多声明一条 `*` 路由；`*` 不能声明 `data` 绑定。资产、`/_action`、admin、`/_system` 等仍由核心返回纯文本 404。

```ts
route("*", page("not-found", {}))
```

对应 `pages/not-found.tsx`。该页与普通页面一样可使用 document、主题样式与 islands；状态码与传输头仍由核心控制。

除 `*` 外，页面的 `data` 至少声明一个绑定。绑定名就是页面组件收到的 prop 名。

### 列表绑定

```ts
page("archives", {
  posts: { collection: "posts" },
})
```

页面收到 `posts: readonly ContentRecord[]`。可以使用：

```ts
posts: { collection: "posts", limit: 20 }
posts: { collection: "posts", paginate: 10 }
```

每个页面最多有一个分页绑定。分页使用 `?page=2`，并额外向页面传入 `pagination: Pagination`。

### 单项绑定

参数化内容路由通过内容源路径生成 URL：

```ts
route(
  "/posts/:year/:slug",
  page("post", {
    post: {
      collection: "posts",
      match: "posts/:year/:slug.md",
    },
  }),
)
```

`content/posts/2026/hello.md` 会发布到 `/posts/2026/hello`。URL 参数必须能由 `match` 中的同名参数生成；一个路由最多有一个单项绑定，带参数的路由必须有单项绑定。

同一内容只有一个 URL 时自动视为 canonical。若同一内容通过多个路由发布，必须且只能把其中一个声明为 canonical：

```ts
route("/posts/:slug", postPage, { canonical: true })
```

内容记录的 `url` 始终指向 canonical URL；没有任何单项路由的记录，其 `url` 为空字符串。

### 服务绑定

主题可以在 SSR 阶段读取插件服务：

```ts
page("notes", {
  notes: { collection: "notes" },
  commentCounts: {
    service: "comments.counts",
    input: {
      contentIds: { from: "notes" },
    },
  },
})
```

`input` 中的普通值按字面量传入；`{ from: "notes" }` 引用同一页面的另一个绑定结果，也可用点路径引用嵌套输出。服务依赖可以串联，但不能引用不存在的数据、自己或形成循环。

带服务绑定的页面会在请求期执行服务和 SSR；纯内容页面可在发布阶段预渲染。

## 页面数据类型

内容记录的公共形状：

```ts
interface ContentRecord {
  id: string;
  created: string;
  sourcePath: string;
  url: string;
  attributes: Readonly<Record<string, unknown>>;
  html: string;
}
```

分页页面还会收到：

```ts
interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}
```

`html` 是可信内容源经过 Markdown 管线生成的 HTML，通常用 `dangerouslySetInnerHTML` 渲染。Diitey 允许 Markdown 中的原始 HTML，不提供内容净化；不要把不可信用户输入写入内容文件。

## document 与主题配置

主题可声明一个共享 document，负责完整的 `<html>`、`<head>`、`<body>` 和站点 chrome：

```tsx
// pages/document.tsx
import type { ComponentChildren } from "preact";
import { useThemeConfig, useThemeStylesheet } from "diitey";
import type { ThemeConfig } from "../theme.ts";

export default function Document({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  const config = useThemeConfig<ThemeConfig>();
  const stylesheet = useThemeStylesheet();

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title === "Diitey" ? config.siteName : `${title} — ${config.siteName}`}</title>
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

单项内容页的 `title` 来自字符串类型的 `attributes.title`，其他页面当前使用 `Diitey`。未声明 document 时，核心会用最小 HTML 壳包裹页面。

`useThemeConfig<Config>()` 可在主题页面和 document 的 SSR 中读取解析后的主题配置。核心不会把整份配置自动发送到浏览器；island 需要哪些值，就显式作为 props 传入哪些值。island 内调用 `useThemeConfig` 会报错。

## 样式

在主题定义中声明：

```ts
{
  document: "document",
  styles: "styles",
  // ...
}
```

核心在启动时用 `Bun.build` 构建 `styles.css`，生成 `/assets/theme/styles-{hash}.css`，并通过 `useThemeStylesheet()` 把 URL 提供给 SSR。document 需要自行写入 `<link>`。

普通 CSS 无需其他配置。使用 Tailwind 时，在站点安装 `tailwindcss` 与 `bun-plugin-tailwind`，并在入口中明确扫描主题文件：

```css
@import "tailwindcss";
@source "./pages/**/*.{ts,tsx}";
@source "./islands/**/*.{ts,tsx}";
@source "./shared/**/*.{ts,tsx}";
```

核心不会自动扫描 Markdown 中动态出现的 class。主题 CSS 在启动时固定，修改后需要重启。

## islands

`islands/` 顶层的每个 `.ts` 或 `.tsx` 文件都会按文件名构建为浏览器入口。先写一个默认导出组件：

```tsx
// islands/counter.tsx
import { useState } from "preact/hooks";

export default function Counter({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

再从页面挂载：

```tsx
import { Island } from "diitey";
import Counter from "../islands/counter.tsx";

<Island name="counter" component={Counter} props={{ initial: 0 }} />
```

注意：

- `name` 必须与 island 文件名一致；
- props 必须是可 JSON 序列化的有限值、数组或普通对象；
- island 会先 SSR，再在浏览器 hydrate；
- 浏览器依赖安装在站点根目录；
- island 及其依赖修改后需要重启，内容 reload 不会重新构建 bundle。

发布侧交互需要写数据时，应调用插件公开的 `/_action/<action-name>`，不要让主题直接访问 SQLite。

## 资源

Markdown 相对链接到的非 Markdown 文件会作为内容资源发布。例如：

```md
![封面](./images/cover.jpg)
```

核心会把它改写为内容寻址的 `/assets/content/...` URL，并让它随内容快照原子更新。

站点级固定资源应放在站点根 `public/`，以根路径访问，例如 `public/favicon.ico` → `/favicon.ico`。它们不属于主题构建，变化立即生效。

## 本地主题与主题包

本地主题用相对路径选择：

```ts
theme: "./themes/my-theme/theme.ts"
```

主题也可以发布为 Bun 可解析的包：

```ts
theme: {
  use: "@example/diitey-theme",
  config: { siteName: "My Site", pageSize: 10 },
}
```

包入口应默认导出 `defineTheme(...)` 的结果，并保留入口旁的 `pages/`、`islands/` 和 CSS 文件。主题使用的 Preact、Zod、Tailwind 等依赖仍由包或站点的 `package.json` 正确声明；Diitey 不管理扩展包生命周期。

## 开发与排错

开发主题时建议每次结构性修改后重启站点：

```bash
bun index.ts start --root path/to/site --port 3000
```

只修改内容时使用：

```bash
bun index.ts reload --root path/to/site
bun index.ts status --root path/to/site
```

提交主题前至少检查：

- 所有集合 glob、schema、过滤和排序能通过完整内容集校验；
- 路由无冲突，参数都能从 `match` 生成；
- 多 URL 内容恰好有一个 canonical 路由；
- 页面 props 与绑定名一致；
- document 输出完整文档树并挂载主题样式表；
- island props 可 JSON 序列化，且不泄露服务端配置或秘密；
- 主题、插件与配置变更通过重启验证，而不是误用内容 reload。

可运行的完整参考见 [`templates/default-site/themes/void`](../templates/default-site/themes/void/)；更小的测试主题见 [`test/fixtures/minimal-site/themes/minimal`](../test/fixtures/minimal-site/themes/minimal/)。
