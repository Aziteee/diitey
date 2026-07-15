import { definePlugin, PluginNotFoundError } from "diitey";
import { z } from "zod";

const commentsPluginConfig = z
  .object({
    maxBodyLength: z.number().int().positive().max(10_000),
    maxAuthorNameLength: z.number().int().positive().max(200),
  })
  .strict()
  .default({
    maxBodyLength: 2_000,
    maxAuthorNameLength: 40,
  });

export type CommentsPluginConfig = z.infer<typeof commentsPluginConfig>;

const replyToOutput = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    authorName: z.string(),
  })
  .strict();

const commentNodeOutput = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contentId: z.string(),
    parentId: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    replyTo: replyToOutput.nullable(),
    authorName: z.string(),
    body: z.string(),
    createdAt: z.string(),
  })
  .strict();

const commentTreeNodeOutput = commentNodeOutput.extend({
  replies: z.array(commentNodeOutput),
});

const listOutput = z.array(commentTreeNodeOutput);

type ReplyTo = z.infer<typeof replyToOutput>;
type CommentNode = z.infer<typeof commentNodeOutput>;
type CommentTreeNode = z.infer<typeof commentTreeNodeOutput>;

interface CommentRow {
  readonly id: number;
  readonly contentId: string;
  readonly parentId: number | null;
  readonly replyToId: number | null;
  readonly authorName: string;
  readonly email: string | null;
  readonly body: string;
  readonly createdAt: string;
}

export default definePlugin({
  config: commentsPluginConfig,
  setup(config) {
    const listInput = z
      .object({
        contentId: z.string().trim().min(1),
      })
      .strict();

    const createInput = z
      .object({
        contentId: z.string().trim().min(1),
        parentId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable()
          .optional()
          .default(null),
        replyToId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable()
          .optional()
          .default(null),
        authorName: z
          .string()
          .trim()
          .min(1)
          .max(config.maxAuthorNameLength),
        email: z
          .union([
            z.string().trim().email().max(254),
            z.literal(""),
            z.null(),
          ])
          .optional()
          .transform((value) =>
            value === "" || value == null ? null : value,
          ),
        body: z.string().trim().min(1).max(config.maxBodyLength),
      })
      .strict();

    const emptyInput = z.object({}).strict();
    const deleteInput = z
      .object({
        id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict();
    const adminCommentOutput = z
      .object({
        id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        contentId: z.string(),
        parentId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable(),
        authorName: z.string(),
        email: z.string().nullable(),
        body: z.string(),
        createdAt: z.string(),
        contentUrl: z.string().nullable(),
        contentTitle: z.string().nullable(),
      })
      .strict();
    const adminListOutput = z
      .object({
        comments: z.array(adminCommentOutput),
        total: z.number().int().nonnegative(),
      })
      .strict();
    const deleteOutput = z
      .object({
        id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        deleted: z.number().int().nonnegative(),
      })
      .strict();

    return {
      id: "comments",
      version: "1.0.0",
      schemaVersion: 1,

      adminPage: {
        component: "./admin.tsx",
        title: "Comments",
        dataService: "comments.adminList",
      },

      migrations: [
        {
          id: "0001-create-comments",
          schemaVersion: 1,
          sql: `
            CREATE TABLE comments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              content_id TEXT NOT NULL,
              parent_id INTEGER,
              reply_to_id INTEGER,
              author_name TEXT NOT NULL,
              email TEXT,
              body TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX comments_content_id_idx ON comments (content_id);
            CREATE INDEX comments_parent_id_idx ON comments (parent_id);
          `,
        },
      ],

      services: {
        "comments.list": {
          input: listInput,
          output: listOutput,
          handler(input, { database }) {
            const rows = database
              .query<CommentRow, [string]>(
                `SELECT
                   id,
                   content_id AS contentId,
                   parent_id AS parentId,
                   reply_to_id AS replyToId,
                   author_name AS authorName,
                   email,
                   body,
                   created_at AS createdAt
                 FROM comments
                 WHERE content_id = ?
                 ORDER BY id ASC`,
              )
              .all(input.contentId);

            return buildCommentTree(rows);
          },
        },

        "comments.adminList": {
          input: emptyInput,
          output: adminListOutput,
          handler(_input, { database, content }) {
            const rows = database
              .query<CommentRow, []>(
                `SELECT
                   id,
                   content_id AS contentId,
                   parent_id AS parentId,
                   reply_to_id AS replyToId,
                   author_name AS authorName,
                   email,
                   body,
                   created_at AS createdAt
                 FROM comments
                 ORDER BY id DESC
                 LIMIT 500`,
              )
              .all();

            const comments = rows.map((row) => {
              const summary = content.get(row.contentId);
              const title = summary
                ? readContentTitle(summary.attributes)
                : null;
              return {
                id: row.id,
                contentId: row.contentId,
                parentId: row.parentId,
                authorName: row.authorName,
                email: row.email,
                body: row.body,
                createdAt: row.createdAt,
                contentUrl: summary?.url ?? null,
                contentTitle: title,
              };
            });

            return { comments, total: comments.length };
          },
        },

        "comments.delete": {
          input: deleteInput,
          output: deleteOutput,
          handler(input, { database }) {
            const row = database
              .query<{ id: number; parentId: number | null }, [number]>(
                `SELECT id, parent_id AS parentId FROM comments WHERE id = ?`,
              )
              .get(input.id);
            if (!row) {
              throw new PluginNotFoundError(`Comment ${input.id} does not exist`);
            }

            let deleted = 0;
            if (row.parentId === null) {
              const replies = database
                .query(
                  `DELETE FROM comments WHERE parent_id = ? OR id = ?`,
                )
                .run(input.id, input.id);
              deleted = Number(replies.changes);
            } else {
              const result = database
                .query(`DELETE FROM comments WHERE id = ?`)
                .run(input.id);
              deleted = Number(result.changes);
            }

            return { id: input.id, deleted };
          },
        },

        "comments.create": {
          input: createInput,
          output: commentNodeOutput,
          handler(input, { content, database }) {
            if (!content.exists(input.contentId)) {
              throw new PluginNotFoundError("content does not exist");
            }

            const parentId = input.parentId ?? null;
            const replyToId = input.replyToId ?? null;
            let replyTo: ReplyTo | null = null;

            if (parentId === null) {
              if (replyToId !== null) {
                throw new Error(
                  "root comments cannot set replyToId",
                );
              }
            } else {
              const parent = database
                .query<CommentRow, [number]>(
                  `SELECT
                     id,
                     content_id AS contentId,
                     parent_id AS parentId,
                     reply_to_id AS replyToId,
                     author_name AS authorName,
                     email,
                     body,
                     created_at AS createdAt
                   FROM comments
                   WHERE id = ?`,
                )
                .get(parentId);

              if (!parent || parent.contentId !== input.contentId) {
                throw new PluginNotFoundError("parent comment does not exist");
              }
              if (parent.parentId !== null) {
                throw new Error(
                  "parent must be a root comment; replies stay one level deep",
                );
              }

              if (replyToId !== null) {
                const target = database
                  .query<CommentRow, [number]>(
                    `SELECT
                       id,
                       content_id AS contentId,
                       parent_id AS parentId,
                       reply_to_id AS replyToId,
                       author_name AS authorName,
                       email,
                       body,
                       created_at AS createdAt
                     FROM comments
                     WHERE id = ?`,
                  )
                  .get(replyToId);

                if (!target || target.contentId !== input.contentId) {
                  throw new PluginNotFoundError(
                    "reply target does not exist",
                  );
                }
                if (target.parentId !== parentId) {
                  throw new Error(
                    "replyToId must belong to the same thread as parentId",
                  );
                }

                replyTo = {
                  id: target.id,
                  authorName: target.authorName,
                };
              }
            }

            const createdAt = new Date().toISOString();
            const email =
              input.email === "" || input.email == null
                ? null
                : input.email;

            const result = database
              .query(
                `INSERT INTO comments (
                   content_id,
                   parent_id,
                   reply_to_id,
                   author_name,
                   email,
                   body,
                   created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                input.contentId,
                parentId,
                replyToId,
                input.authorName,
                email,
                input.body,
                createdAt,
              );

            return {
              id: Number(result.lastInsertRowid),
              contentId: input.contentId,
              parentId,
              replyTo,
              authorName: input.authorName,
              body: input.body,
              createdAt,
            } satisfies CommentNode;
          },
        },
      },

      actions: {
        "comments.create": {
          service: "comments.create",
          bodyLimitBytes: 4_096,
          rateLimit: { limit: 10, windowMs: 60_000 },
          timeoutMs: 2_000,
        },
        delete: {
          service: "comments.delete",
          access: "admin",
          bodyLimitBytes: 256,
          rateLimit: { limit: 60, windowMs: 60_000 },
          timeoutMs: 2_000,
        },
      },
    };
  },
});

function buildCommentTree(rows: readonly CommentRow[]): CommentTreeNode[] {
  const byId = new Map<number, CommentRow>();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  const roots: CommentTreeNode[] = [];
  const repliesByParent = new Map<number, CommentNode[]>();

  for (const row of rows) {
    if (row.parentId === null) {
      roots.push({
        ...toPublicNode(row, null),
        replies: [],
      });
      continue;
    }

    const replyTo = resolveReplyTo(row, byId);
    const node = toPublicNode(row, replyTo);
    const siblings = repliesByParent.get(row.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      repliesByParent.set(row.parentId, [node]);
    }
  }

  for (const root of roots) {
    root.replies.push(...(repliesByParent.get(root.id) ?? []));
  }

  return roots;
}

function resolveReplyTo(
  row: CommentRow,
  byId: ReadonlyMap<number, CommentRow>,
): ReplyTo | null {
  if (row.replyToId === null) return null;
  const target = byId.get(row.replyToId);
  if (!target) return null;
  return { id: target.id, authorName: target.authorName };
}

function toPublicNode(row: CommentRow, replyTo: ReplyTo | null): CommentNode {
  return {
    id: row.id,
    contentId: row.contentId,
    parentId: row.parentId,
    replyTo,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function readContentTitle(
  attributes: Readonly<Record<string, unknown>>,
): string | null {
  const title = attributes.title;
  return typeof title === "string" && title.trim() ? title : null;
}
