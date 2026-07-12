import {
  definePlugin,
  PluginNotFoundError,
} from "../../../../../src/index.ts";

interface TodoItem {
  readonly id: number;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: string;
}

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly completed: number;
  readonly createdAt: string;
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("input must be an object");
  }
  return value as Record<string, unknown>;
}

const listInput = {
  parse(value: unknown): Record<string, never> {
    const input = inputRecord(value);
    if (Object.keys(input).length !== 0) {
      throw new Error("todo.list does not accept fields");
    }
    return {};
  },
};

const createInput = {
  parse(value: unknown): { readonly title: string } {
    const input = inputRecord(value);
    if (
      typeof input.title !== "string" ||
      input.title.trim().length === 0 ||
      input.title.trim().length > 100
    ) {
      throw new Error("title must contain 1 to 100 characters");
    }
    return { title: input.title.trim() };
  },
};

const toggleInput = {
  parse(value: unknown): { readonly id: number } {
    const input = inputRecord(value);
    if (!Number.isSafeInteger(input.id) || Number(input.id) <= 0) {
      throw new Error("id must be a positive integer");
    }
    return { id: Number(input.id) };
  },
};

const todoOutput = {
  parse(value: unknown): TodoItem {
    const row = inputRecord(value);
    if (
      !Number.isSafeInteger(row.id) ||
      typeof row.title !== "string" ||
      typeof row.completed !== "boolean" ||
      typeof row.createdAt !== "string"
    ) {
      throw new Error("invalid todo output");
    }
    return row as unknown as TodoItem;
  },
};

const todoListOutput = {
  parse(value: unknown): readonly TodoItem[] {
    if (!Array.isArray(value)) throw new Error("invalid todo list output");
    return value.map((item) => todoOutput.parse(item));
  },
};

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
