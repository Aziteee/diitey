import {
  definePlugin,
  PluginNotFoundError,
} from "diitey";
import { z } from "zod";

const todoOutput = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    title: z.string(),
    completed: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

type TodoItem = z.infer<typeof todoOutput>;

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly completed: number;
  readonly createdAt: string;
}

const listInput = z.object({}).strict();
const createInput = z
  .object({
    title: z.string().trim().min(1).max(100),
  })
  .strict();
const toggleInput = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const todoListOutput = z.array(todoOutput);

export default definePlugin({
  id: "todo-list",
  version: "1.0.0",
  schemaVersion: 1,

  migrations: [
    {
      id: "0001-create-todo-items",
      schemaVersion: 1,
      sql: `
        CREATE TABLE todo_list_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `,
    },
  ],

  services: {
    "todo.list": {
      input: listInput,
      output: todoListOutput,
      handler(_input, { database }) {
        const rows = database
          .query<TodoRow, []>(
            `SELECT id, title, completed, created_at AS createdAt
             FROM todo_list_items
             ORDER BY completed ASC, id DESC`,
          )
          .all();
        return rows.map(toTodoItem);
      },
    },

    "todo.create": {
      input: createInput,
      output: todoOutput,
      handler(input, { database }) {
        const createdAt = new Date().toISOString();
        const result = database
          .query(
            `INSERT INTO todo_list_items (title, completed, created_at)
             VALUES (?, 0, ?)`,
          )
          .run(input.title, createdAt);
        return {
          id: Number(result.lastInsertRowid),
          title: input.title,
          completed: false,
          createdAt,
        };
      },
    },

    "todo.toggle": {
      input: toggleInput,
      output: todoOutput,
      handler(input, { database }) {
        const result = database
          .query(
            `UPDATE todo_list_items
             SET completed = CASE completed WHEN 0 THEN 1 ELSE 0 END
             WHERE id = ?`,
          )
          .run(input.id);
        if (result.changes === 0) {
          throw new PluginNotFoundError(`Todo item ${input.id} does not exist`);
        }
        const row = database
          .query<TodoRow, [number]>(
            `SELECT id, title, completed, created_at AS createdAt
             FROM todo_list_items
             WHERE id = ?`,
          )
          .get(input.id);
        if (!row) throw new PluginNotFoundError("Todo item does not exist");
        return toTodoItem(row);
      },
    },
  },

  actions: {
    "todo.create": {
      service: "todo.create",
      bodyLimitBytes: 512,
      rateLimit: { limit: 20, windowMs: 60_000 },
      timeoutMs: 2_000,
    },
    "todo.toggle": {
      service: "todo.toggle",
      bodyLimitBytes: 128,
      rateLimit: { limit: 60, windowMs: 60_000 },
      timeoutMs: 2_000,
    },
  },
});

function toTodoItem(row: TodoRow): TodoItem {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed !== 0,
    createdAt: row.createdAt,
  };
}
