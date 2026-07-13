# Todo List 示例插件

这是一个只提供后端动态能力的简单插件，包含：

- `todo.list`：按“未完成优先、最新优先”列出待办项；
- `todo.create`：创建待办项；
- `todo.toggle`：切换完成状态；
- 一条启动时自动应用的 SQLite 插件迁移；
- 创建和切换状态所需的核心 Action。

## 启用插件

在站点的 `site.config.ts` 中加入插件路径：

```ts
export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/todo-list/plugin.ts"],
});
```

路径应按插件相对于实际站点根目录的位置调整。首次启动站点时，核心会在开始
HTTP 监听前自动应用待处理插件迁移。

## SSR 列表

主题可以给页面声明一个插件服务绑定：

```ts
route("/todos", page("todo-list", {
  items: {
    service: "todo.list",
    input: {},
  },
}))
```

页面会收到 `items`：

```tsx
interface TodoItem {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

export default function TodoList({ items }: { items: readonly TodoItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li>
          <input type="checkbox" checked={item.completed} readOnly />
          {item.title}
        </li>
      ))}
    </ul>
  );
}
```

## Island 提交

交互组件属于主题，不属于插件。主题 island 可调用：

```ts
await fetch("/_action/todo.create", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "写一篇文章" }),
});

await fetch("/_action/todo.toggle", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: 1 }),
});
```

Action 成功后可以重新请求页面或刷新，使 SSR 列表显示最新状态。
