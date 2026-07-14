# 核心拥有主题样式表管线，主题拥有 CSS 工具链

主题可声明可选的 **styles** 入口（如 `"styles"` → 主题入口旁的 `styles.css`）。核心在站点程序编译时用 `Bun.build` 构建该 CSS，产出内容哈希路径 `/assets/theme/styles-{hash}.css`，钉在站点程序上，并由发布运行时以不可变长缓存与 `text/css` 提供；SSR 通过 `useThemeStylesheet()` 暴露 URL，由主题 document 自行挂 `<link>`。内容 `reload` 不重建样式表（与 islands 同生命周期，ADR-0009）。**Tailwind 等工具链由主题依赖与 CSS 源决定**；核心不依赖 `tailwindcss`、不跑独立 PostCSS、不自动扫描 Markdown class。未声明 styles 时行为与原先一致。

命名选择：主题字段 `styles`，SSR 助手 `useThemeStylesheet`，发布视图并行 `themeAssetsByPath`（V1 不合并 island 资产 map）。

测试：V1 以 HTTP 全链路覆盖 plain CSS、启动失败与 reload pin；fixture-local Tailwind 按需断言因 CI 成本延后，按需契约见 README 主题作者说明。
