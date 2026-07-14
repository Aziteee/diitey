# 主题拥有可选文档壳

主题可声明一个共享的 **document** 页面组件，渲染完整的 `<html>` / `<head>` / `<body>` 与全站 chrome；核心仍拥有路由、数据注入、SSR、islands、HTTP 头、doctype 前缀，以及未声明 document 时的最小回退壳。相比让页面返回任意完整 HTML 字符串或允许插件注入全局布局，这把呈现边界固定在主题侧，同时保持现有仅返回 body 片段的主题零配置兼容。
