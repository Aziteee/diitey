# 核心拥有主题样式表管线，主题拥有 CSS 工具链

主题可声明可选的 **styles** 入口（如 `"styles"` → 主题入口旁的 `styles.css`）。核心在站点程序编译时用 `Bun.build` 构建该 CSS，产出内容哈希路径 `/assets/theme/styles-{hash}.css`，钉在站点程序上，并由发布运行时以不可变长缓存与 `text/css` 提供；SSR 通过 `useThemeStylesheet()` 暴露 URL，由主题 document 自行挂 `<link>`。内容 `reload` 不重建样式表（与 islands 同生命周期，ADR-0009）。**主题侧 Tailwind 等工具链仍由站点依赖与 CSS 源决定**；核心不跑独立 PostCSS、不自动扫描 Markdown class。核心在 `Bun.build` 时若能解析 `bun-plugin-tailwind`（站点根或核心自身依赖）则自动挂上，以支持 `@import "tailwindcss"` 与 `@source` 按需编译。admin surface 的 shell 与可选插件 admin `styles` 复用同一构建管线（见 ADR-0013）；核心因此将 `tailwindcss` 与 `bun-plugin-tailwind` 列为自身依赖，以便 admin CSS 在未装主题 Tailwind 的站点上仍可构建。未声明 styles 时主题行为与原先一致。

命名选择：主题字段 `styles`，SSR 助手 `useThemeStylesheet`，发布视图并行 `themeAssetsByPath`（V1 不合并 island 资产 map）。

测试：V1 以 HTTP 全链路覆盖 plain CSS、启动失败与 reload pin；minimal fixture 的 styles 使用 Tailwind 入口作为作者示例。
