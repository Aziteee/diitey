import { Island } from "../../../../../../src/index.ts";
import TodoList from "../islands/todo-list.tsx";

export interface TodoItem {
  readonly id: number;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: string;
}

export default function TodoListPage({
  items,
}: {
  readonly items: readonly TodoItem[];
}) {
  return (
    <main>
      <h1>Todo list</h1>
      <Island
        name="todo-list"
        component={TodoList}
        props={{ initialItems: items }}
      />
    </main>
  );
}
