# Comments 插件

仅后端的评论动态能力：SQLite 存储、类型化服务与 Action。页面与 island 仍由主题提供。

## 线程模型

最多视觉一级：根评论下挂平级回复。对某条回复再回复时，新评论仍挂在**同一根**下，并用 `replyTo` 标记被 @ 的目标。

| 场景 | parentId | replyToId |
|------|----------|-----------|
| 新根评论 | `null` | `null` |
| 直接回复根评论 C1 | `C1` | `null` |
| 回复 C1 下的回复 R1 | `C1` | `R1` |

规则：

- `parentId` 必须是根评论（其自身 `parentId` 为 null），否则拒绝
- `replyToId` 必须与 `parentId` 同内容、同线程，且目标存在
- 根评论不得设置 `replyToId`

## 启用

```ts
plugins: [
  {
    use: "./plugins/comments/plugin.ts",
    config: {
      maxBodyLength: 2000,
      maxAuthorNameLength: 40,
    },
  },
],
```

配置变更需重启。首次启动会应用迁移 `0001-create-comments`。

## 服务

### `comments.list`

输入：`{ contentId: string }`

输出：两层树（公开字段不含 email）：

```ts
type ReplyTo = { id: number; authorName: string };

type CommentNode = {
  id: number;
  contentId: string;
  parentId: number | null;
  replyTo: ReplyTo | null;
  authorName: string;
  body: string;
  createdAt: string;
};

type CommentTreeNode = CommentNode & { replies: CommentNode[] };
// 返回 CommentTreeNode[]
```

悬空 `replyToId`（目标已不存在）在 list 中降级为 `replyTo: null`。

### `comments.create`

输入：

```ts
{
  contentId: string;
  parentId?: number | null;   // 默认 null
  replyToId?: number | null;  // 默认 null
  authorName: string;
  email?: string | null;      // 可选；只存库，不进公开输出
  body: string;
}
```

输出：新建的那条 `CommentNode`（无 email）。

`contentId` 必须对应现有内容记录，否则 `PluginNotFoundError`。

## Action

```ts
await fetch("/_action/comments.create", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contentId: "void-first-entry",
    authorName: "访客",
    email: "optional@example.com",
    body: "你好",
  }),
});
```

## 主题接入

`void` 主题已在文章页绑定：

```ts
comments: {
  service: "comments.list",
  input: { contentId: { from: "post.id" } },
}
```

列表由 SSR 注入 island props；提交表单在主题 island 中调用 `/_action/comments.create`，成功后刷新页面。

## Admin

插件声明了单一 admin 页（路径 `/_admin/comments`），需配置 admin token 后启动：

```bash
diitey start --admin-token "<32+ byte token>"
```

| 能力 | 说明 |
|------|------|
| `comments.adminList` | SSR dataService：最近 500 条评论（含 email、内容 URL/标题） |
| `POST /_admin/action/comments/delete` | 删除评论；删根评论时一并删除其回复 |

admin 浏览器组件：`./admin.tsx`。
