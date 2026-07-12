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

## 验证

```bash
bun test
bun run typecheck
```
