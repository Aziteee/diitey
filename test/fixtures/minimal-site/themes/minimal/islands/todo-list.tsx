import { useState } from "preact/hooks";
import type { TodoItem } from "../pages/todo-list.tsx";

export default function TodoList({
  initialItems,
}: {
  readonly initialItems: readonly TodoItem[];
}) {
  const [items, setItems] = useState<readonly TodoItem[]>(initialItems);
  const [title, setTitle] = useState("");

  async function createTodo(event: SubmitEvent) {
    event.preventDefault();
    const response = await fetch("/_action/todo.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return;
    const item = (await response.json()) as TodoItem;
    setItems([item, ...items]);
    setTitle("");
  }

  async function toggleTodo(id: number) {
    const response = await fetch("/_action/todo.toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) return;
    const updated = (await response.json()) as TodoItem;
    setItems(items.map((item) => (item.id === id ? updated : item)));
  }

  return (
    <section>
      <form onSubmit={createTodo}>
        <input
          aria-label="Todo title"
          maxlength={100}
          required
          value={title}
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <button type="submit">Add todo</button>
      </form>
      <ul>
        {items.map((item) => (
          <li key={item.id} data-completed={String(item.completed)}>
            <button type="button" onClick={() => toggleTodo(item.id)}>
              {item.completed ? "Mark incomplete" : "Mark complete"}
            </button>{" "}
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
