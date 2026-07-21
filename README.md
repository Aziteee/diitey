# Diitey

一个以 Markdown 文件为内容真相、由主题解释网站结构的个人站点系统。

> *Diitey* 取自上古卷轴系列中的龙语（Thu'um），由 *dii* 与 *tey* 复合而成，意为「我的故事」。

## 功能

- Markdown 为核心，Agent 友好
- 主题声明内容路由，自定义程度高
- Preact 服务端渲染，可选 island 局部交互
- 受鉴权的核心管理界面，插件可挂载单个管理页
- 内容热更新，原子切换

## 快速开始

需要 [Bun](https://bun.sh/)。先安装项目依赖，再运行仓库中的默认站点：

```bash
bun install
cd templates/default-site
bun install
bun run start --port 3000
```

打开 `http://127.0.0.1:3000`。默认模板包含文章、短笔记、固定页面、代码高亮和评论示例。

修改 `templates/default-site/content/` 下的 Markdown 后，在另一个终端执行：

```bash
cd templates/default-site
bun run reload
bun run status
```

最小内容文件如下：

```md
---
id: "hello-diitey"
created: "2026-07-18"
title: "Hello, Diitey"
---

这是正文。
```

> 每个内容文件都必须有全站唯一的字符串 `id`，以及 ISO 8601 格式的字符串 `created`。

## 站点配置

站点根目录的 `site.config.ts` 选择内容目录、主题和插件：

```ts
import { defineSite } from "diitey";

export default defineSite({
  contentDir: "content",
  theme: {
    use: "./themes/void/theme.ts",
    config: {
      siteName: "My Site",
      siteDescription: "Notes and writing",
      language: "zh-CN",
      homePosts: 6,
      homeNotes: 3,
      postsPerPage: 10,
      notesPerPage: 20,
    },
  },
  plugins: [
    "./plugins/pangu/plugin.ts",
    {
      use: "./plugins/comments/plugin.ts",
      config: { maxBodyLength: 2000, maxAuthorNameLength: 40 },
    },
  ],
  reload: { timeoutMs: 30_000 },
});
```

扩展引用可以是相对站点根的源码路径、绝对路径，或已由 Bun 安装的包名。Diitey 不负责安装和升级扩展；请直接维护站点的 `package.json` 与 `bun.lock`。

`contentDir` 默认为 `content`。相对路径按站点根解析，也可以使用站点根之外的绝对目录。如你的 Obsidian 笔记目录。

## 命令行

```text
diitey <start|reload|status> [options]
```

本仓库中使用 `bun index.ts` 代替 `diitey` 可执行文件：

| 命令 | 作用 |
| --- | --- |
| `bun index.ts start --root <site>` | 校验并启动站点 |
| `bun index.ts reload --root <site>` | 请求运行中的站点重建内容 |
| `bun index.ts status --root <site>` | 查看当前内容快照和最近构建状态 |

`start` 与 `reload` 还支持：

| 参数 / 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `--ensure-content-fields` | 关闭 | 本次构建前为真缺的 `id` / `created` 写回内容文件（无 Front Matter 时插入完整块；非法已有值失败不覆盖） |
| `--host` | `127.0.0.1` | HTTP 监听地址（仅 `start`） |
| `--port` | `3000` | HTTP 端口（仅 `start`） |
| `--public-origin` / `DIITEY_PUBLIC_ORIGIN` | 监听 origin | 对外 origin；启用远程管理时必须明确配置（仅 `start`） |
| `--admin-token` / `DIITEY_ADMIN_TOKEN` | 未启用 | 启用 `/_admin`；token 至少 32 字节（仅 `start`） |
| `--ensure-content-fields` | `false` | 自动补全并写回缺失字段（`id` 为 UUID，`created` 取文件创建时间） |
| `DIITEY_LOG_LEVEL` | `info` | `error`、`warn` 或 `info` |

## reload 与重启

`reload` 只重建内容快照。成功时原子替换路由、页面数据和内容资源；失败或超时不会影响当前站点。

以下修改需要重启 `start` 进程：

- `site.config.ts` 与 `contentDir`；
- 主题、页面、document、island 和主题 CSS；
- 插件、插件配置、迁移、管理页和插件发布资源。

`public/` 中的站点静态资源是例外：它们按根路径直接读取，增删改立即生效，不需要 reload。该目录适合 `favicon.ico`、`robots.txt` 和 `/.well-known/*`。

## 模块分工

| 部分 | 负责 |
| --- | --- |
| 内容 | Markdown 正文、Front Matter 属性、随内容发布的资源 |
| 主题 | 集合、路由、页面、document、样式和发布侧 island |
| 插件 | Markdown 转换、类型化服务、Action、SQLite 迁移、可选管理页 |
| 核心 | 校验、SSR、资源构建、原子发布、管理入口与安全边界 |

## 开发文档

- [主题开发](docs/theme-development.md)：集合、路由、页面、document、样式与 islands；
- [插件开发](docs/plugin-development.md)：配置、Markdown 扩展、服务、Action、迁移、管理页与发布资源；
- [默认站点模板](templates/default-site/README.md)：`void` 主题的内容约定；
- [架构决策](docs/adr/)：核心边界与重要取舍。

## 仓库结构

```text
.
├── index.ts                  # CLI 入口
├── src/                      # 核心运行时
├── templates/default-site/   # 可运行的默认站点
├── test/                     # 单元与端到端测试、最小站点 fixture
└── docs/
    ├── theme-development.md
    ├── plugin-development.md
    └── adr/                  # 架构决策记录
```

## 参与开发

```bash
bun install
bun test
bun run typecheck
```

主题和插件是站点所有者主动选择的可信本地代码，会与核心运行在同一 Bun 进程中，并不处于安全沙箱。不要加载不可信扩展。
