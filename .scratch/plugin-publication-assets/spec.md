# 插件发布资源与 document head 片段

Status: ready-for-agent

## 问题陈述

插件可以通过 Markdown 扩展产生静态语义片段，但当前没有发布侧资源注册能力，也不能向主题 document 的 `<head>` 提供资源链接、样式、预加载提示或其他 head 内容。

需求是增加两个相互配合但边界清晰的能力：

1. 插件声明并发布浏览器静态资源；
2. 插件在最终 document 的 `<head>` 中注入任意 HTML 片段。

插件不应获得任意最终 HTML transform；head 能力不能修改 body、替换完整 document 或接管 HTTP 响应。

## 代码事实

- 主题样式由 `ThemeDefinition.styles` 声明，核心在站点程序编译阶段构建并哈希托管；主题 document 负责挂载样式表。
- islands、主题样式和插件代码都属于站点程序，内容 `reload` 不重建它们。
- `src/publication/content-resources.ts` 已实现内容寻址 artifact 的读取、SHA-256、临时文件、原子 rename、字节长度、MIME 和缓存清理。
- `ContentResourceBuilder` 同时负责 Markdown URL 解析、内容目录 containment、内容快照归属和 reload 生命周期，因此不能直接处理插件资源。
- `EffectivePublication` 目前登记内容资源、island 资源和主题样式资源；插件资源需要增加独立资源 map 和 HTTP 路由。
- ADR-0006 将主题和插件定义为可信本地代码，因此 head 片段允许任意 HTML；这不是安全沙箱能力。

## 决策

### 插件发布资源

插件可声明一组带逻辑名称的文件资源。核心在 `compileSiteProgram()` 阶段：

1. 以插件入口目录为解析基准；
2. 校验文件的真实路径仍位于插件目录内；
3. 通过通用 artifact store 计算 digest 并物化缓存文件；
4. 将资源注册到站点程序和有效发布视图；
5. 在 `/assets/plugins/<plugin-id>/...` 下提供资源；
6. 使用正确 MIME 和 `public, max-age=31536000, immutable`；
7. 资源变化要求重启，内容 `reload` 不重建。

插件必须有显式 ID，以提供稳定的资源命名空间并避免冲突。

### Head 片段

插件可声明一个启动期 head 生成器。核心先完成资源哈希，再以只读 `assetUrl(name)` 上下文调用生成器，按 `site.config.ts` 中的插件顺序组合片段。

片段在最终 document 的 `</head>` 前插入：

```text
主题 Page 渲染
→ 主题 Document 或 fallback shell 组装
→ 插入插件 head 片段
→ 返回 HTTP 响应
```

head 生成器只在站点程序编译时执行一次。生成失败属于站点程序编译失败；请求期间不重新执行，也不接受完整 `Request` 或动态 body 数据。

head 片段可以包含任意 HTML，包括 `<style>`、`<link>`、`<meta>`、`<script>` 等。任意 HTML 的风险由可信本地插件模型承担；核心只限制注入位置和生命周期。

## 基础设施复用

应从 `content-resources.ts` 抽出通用 artifact store，而不是让插件复用 `ContentResourceBuilder`：

```text
通用 artifact store
  ├─ 文件读取与可读性检查
  ├─ SHA-256 / 字节长度 / MIME
  ├─ 临时文件与原子提交
  └─ 未引用 artifact 清理

ContentResourceBuilder
  └─ Markdown URL → 内容快照资源

PluginAssetBuilder
  └─ 插件声明文件 → 站点程序资源
```

两类资源必须保持不同的领域归属和 URL 命名空间：

| 资源 | 归属 | 生命周期 | URL 前缀 |
|---|---|---|---|
| 内容资源 | 内容快照 | 成功 `reload` 更新 | `/assets/content/` |
| 插件发布资源 | 站点程序 | 重启更新 | `/assets/plugins/<plugin-id>/` |

V1 可以使用独立的 `data/cache/plugin-assets` 缓存目录；如果共享目录，清理器必须同时保护当前内容快照和当前站点程序引用的插件 digest。

## 建议的 API 形状

具体字段名仍由实现确定，但语义应类似：

```ts
export default definePlugin({
  id: "example",
  publication: {
    assets: [
      {
        name: "browser-asset",
        file: "./assets/browser-asset.bin",
        contentType: "application/octet-stream",
      },
    ],
    head: ({ assetUrl }) =>
      `<link rel="preload" href="${assetUrl("browser-asset")}">`,
  },
});
```

核心不应要求主题知道插件包路径或复制插件文件；主题只负责 document 结构，插件负责自己的 head 片段和资源引用。

## 需要修改的模块

- `src/index.ts`：增加插件发布资源和 head 声明类型；
- `src/publication/content-resources.ts`：抽出通用 artifact store；
- 新增插件资源构建适配器；
- `src/publication/site-program.ts`：启动期构建和固定插件资源/head；
- `src/publication/effective-publication.ts`：登记插件资源 map；
- `src/publication/runtime.ts`：提供插件资源 HTTP 路由并插入 head 片段；
- 测试：资源服务、MIME/cache、head 注入顺序、fallback shell、reload pin、越界路径、重复资源名和编译失败。

## 非目标

- 任意最终 HTML transform；
- 修改 body 或主题路由；
- 将插件资源放入内容快照；
- 在内容 `reload` 期间重新读取插件代码或资源；
- 将插件资源自动合并进主题 CSS 图谱；
- 为不可信插件提供隔离或权限沙箱。
