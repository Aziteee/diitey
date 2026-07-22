import { definePlugin, PluginNotFoundError } from "diitey";
import { z } from "zod";
import { planCommentNotifications } from "./notify.ts";

const optionalEmailConfig = z
  .union([z.string().trim().email().max(254), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value == null ? null : value));

const optionalBaseUrlConfig = z
  .union([
    z
      .string()
      .trim()
      .url()
      .refine(
        (value) =>
          value.startsWith("https://") || value.startsWith("http://"),
        "publicBaseUrl must be an http(s) origin",
      ),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => {
    if (value === "" || value == null) return null;
    return value.replace(/\/+$/, "");
  });

const commentsPluginConfig = z
  .object({
    maxBodyLength: z.number().int().positive().max(10_000),
    maxAuthorNameLength: z.number().int().positive().max(200),
    /** Site owner address for new-comment notifications; null disables owner channel. */
    ownerEmail: optionalEmailConfig,
    /** Absolute origin for links in notification mail; null keeps site-relative paths. */
    publicBaseUrl: optionalBaseUrlConfig,
  })
  .strict()
  .default({
    maxBodyLength: 2_000,
    maxAuthorNameLength: 40,
    ownerEmail: null,
    publicBaseUrl: null,
  });

export type CommentsPluginConfig = z.infer<typeof commentsPluginConfig>;

const replyToOutput = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    authorName: z.string(),
  })
  .strict();

const websiteOutput = z.string().nullable();

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
    website: websiteOutput,
    body: z.string(),
    createdAt: z.string(),
  })
  .strict();

const commentTreeNodeOutput = commentNodeOutput.extend({
  replies: z.array(commentNodeOutput),
});

const listOutput = z
  .object({
    items: z.array(commentTreeNodeOutput),
    total: z.number().int().nonnegative(),
    rootTotal: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

const countsOutput = z
  .object({
    counts: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

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
  readonly website: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly clientAddress: string | null;
  readonly userAgent: string | null;
}

const COMMENT_ROW_SELECT = `
  id,
  content_id AS contentId,
  parent_id AS parentId,
  reply_to_id AS replyToId,
  author_name AS authorName,
  email,
  website,
  body,
  created_at AS createdAt,
  client_address AS clientAddress,
  user_agent AS userAgent
`;

const optionalWebsite = z
  .union([
    z
      .string()
      .trim()
      .max(500)
      .url()
      .refine(
        (value) =>
          value.startsWith("https://") || value.startsWith("http://"),
        "website must be an http(s) URL",
      ),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === "" || value == null ? null : value));

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export default definePlugin({
  config: commentsPluginConfig,
  setup(config) {
    const listInput = z
      .object({
        contentId: z.string().trim().min(1),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIST_LIMIT)
          .optional()
          .default(DEFAULT_LIST_LIMIT),
        offset: z.number().int().nonnegative().optional().default(0),
      })
      .strict();

    const countsInput = z
      .object({
        contentIds: z
          .array(
            z.union([
              z.string().trim().min(1),
              z
                .object({ id: z.string().trim().min(1) })
                .passthrough(),
            ]),
          )
          .max(200),
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
        website: optionalWebsite,
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
        website: websiteOutput,
        body: z.string(),
        createdAt: z.string(),
        clientAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
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
      version: "1.3.0",
      schemaVersion: 3,

      adminPage: {
        component: "./admin.tsx",
        title: "Comments",
        dataService: "comments.adminList",
        styles: "admin",
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
        {
          id: "0002-add-website",
          schemaVersion: 2,
          sql: `
            ALTER TABLE comments ADD COLUMN website TEXT;
          `,
        },
        {
          id: "0003-add-request-meta",
          schemaVersion: 3,
          sql: `
            ALTER TABLE comments ADD COLUMN client_address TEXT;
            ALTER TABLE comments ADD COLUMN user_agent TEXT;
          `,
        },
      ],

      services: {
        "comments.list": {
          input: listInput,
          output: listOutput,
          handler(input, { database }) {
            const limit = input.limit;
            const offset = input.offset;

            const rootTotalRow = database
              .query<{ count: number }, [string]>(
                `SELECT COUNT(*) AS count
                 FROM comments
                 WHERE content_id = ? AND parent_id IS NULL`,
              )
              .get(input.contentId);
            const rootTotal = Number(rootTotalRow?.count ?? 0);

            const totalRow = database
              .query<{ count: number }, [string]>(
                `SELECT COUNT(*) AS count
                 FROM comments
                 WHERE content_id = ?`,
              )
              .get(input.contentId);
            const total = Number(totalRow?.count ?? 0);

            const rootIds = database
              .query<{ id: number }, [string, number, number]>(
                `SELECT id
                 FROM comments
                 WHERE content_id = ? AND parent_id IS NULL
                 ORDER BY id DESC
                 LIMIT ? OFFSET ?`,
              )
              .all(input.contentId, limit, offset)
              .map((row) => row.id);

            if (rootIds.length === 0) {
              return {
                items: [],
                total,
                rootTotal,
                hasMore: offset + limit < rootTotal,
              };
            }

            const placeholders = rootIds.map(() => "?").join(", ");
            const rows = database
              .query<CommentRow, (string | number)[]>(
                `SELECT ${COMMENT_ROW_SELECT}
                 FROM comments
                 WHERE content_id = ?
                   AND (id IN (${placeholders}) OR parent_id IN (${placeholders}))
                 ORDER BY id ASC`,
              )
              .all(input.contentId, ...rootIds, ...rootIds);

            return {
              items: buildCommentTree(rows).sort((a, b) => b.id - a.id),
              total,
              rootTotal,
              hasMore: offset + limit < rootTotal,
            };
          },
        },

        "comments.counts": {
          input: countsInput,
          output: countsOutput,
          handler(input, { database }) {
            const rawIds = input.contentIds as ReadonlyArray<
              string | { readonly id: string }
            >;
            const contentIds = [
              ...new Set(
                rawIds.map((item) =>
                  typeof item === "string" ? item : item.id,
                ),
              ),
            ];
            const counts: Record<string, number> = Object.create(null);
            for (const id of contentIds) {
              counts[id] = 0;
            }
            if (contentIds.length === 0) {
              return { counts };
            }

            const placeholders = contentIds.map(() => "?").join(", ");
            const rows = database
              .query<{ contentId: string; count: number }, string[]>(
                `SELECT content_id AS contentId, COUNT(*) AS count
                 FROM comments
                 WHERE content_id IN (${placeholders})
                 GROUP BY content_id`,
              )
              .all(...contentIds);

            for (const row of rows) {
              counts[row.contentId] = Number(row.count);
            }
            return { counts };
          },
        },

        "comments.adminList": {
          input: emptyInput,
          output: adminListOutput,
          handler(_input, { database, content }) {
            const rows = database
              .query<CommentRow, []>(
                `SELECT ${COMMENT_ROW_SELECT}
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
                website: row.website ?? null,
                body: row.body,
                createdAt: row.createdAt,
                clientAddress: row.clientAddress ?? null,
                userAgent: row.userAgent ?? null,
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
          async handler(input, { content, database, requestMeta, call, log }) {
            if (!content.exists(input.contentId)) {
              throw new PluginNotFoundError("content does not exist");
            }

            const parentId = input.parentId ?? null;
            const replyToId = input.replyToId ?? null;
            let replyTo: ReplyTo | null = null;
            let replyTargetEmail: string | null = null;

            if (parentId === null) {
              if (replyToId !== null) {
                throw new Error(
                  "root comments cannot set replyToId",
                );
              }
            } else {
              const parent = database
                .query<CommentRow, [number]>(
                  `SELECT ${COMMENT_ROW_SELECT}
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
                    `SELECT ${COMMENT_ROW_SELECT}
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
                // replyTo preferred; fall back to root author when target has no email.
                replyTargetEmail = target.email ?? parent.email;
              } else {
                replyTargetEmail = parent.email;
              }
            }

            const createdAt = new Date().toISOString();
            const email =
              input.email === "" || input.email == null
                ? null
                : input.email;
            const website = input.website ?? null;
            const clientAddress = requestMeta?.clientAddress ?? null;
            const userAgent = requestMeta?.userAgent ?? null;

            const result = database
              .query(
                `INSERT INTO comments (
                   content_id,
                   parent_id,
                   reply_to_id,
                   author_name,
                   email,
                   website,
                   body,
                   created_at,
                   client_address,
                   user_agent
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                input.contentId,
                parentId,
                replyToId,
                input.authorName,
                email,
                website,
                input.body,
                createdAt,
                clientAddress,
                userAgent,
              );

            const node = {
              id: Number(result.lastInsertRowid),
              contentId: input.contentId,
              parentId,
              replyTo,
              authorName: input.authorName,
              website,
              body: input.body,
              createdAt,
            } satisfies CommentNode;

            const summary = content.get(input.contentId);
            const mails = planCommentNotifications({
              ownerEmail: config.ownerEmail ?? null,
              publicBaseUrl: config.publicBaseUrl ?? null,
              contentId: input.contentId,
              contentTitle: summary
                ? readContentTitle(summary.attributes)
                : null,
              contentUrl: summary?.url ?? null,
              authorName: input.authorName,
              authorEmail: email,
              body: input.body,
              isReply: parentId !== null,
              replyTargetEmail:
                parentId === null ? null : replyTargetEmail,
            });

            for (const mail of mails) {
              try {
                await call("mail.send", {
                  to: mail.to,
                  subject: mail.subject,
                  text: mail.text,
                  replyTo: mail.replyTo,
                });
              } catch (error) {
                log.warn(
                  `comment notification failed for ${mail.to}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
            }

            return node;
          },
        },
      },

      actions: {
        "comments.list": {
          service: "comments.list",
          bodyLimitBytes: 512,
          rateLimit: { limit: 60, windowMs: 60_000 },
          timeoutMs: 2_000,
        },
        "comments.counts": {
          service: "comments.counts",
          bodyLimitBytes: 8_192,
          rateLimit: { limit: 60, windowMs: 60_000 },
          timeoutMs: 2_000,
        },
        "comments.create": {
          service: "comments.create",
          bodyLimitBytes: 4_096,
          rateLimit: { limit: 10, windowMs: 60_000 },
          // Allows best-effort notification (mail has its own shorter deadline).
          timeoutMs: 5_000,
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
    website: row.website ?? null,
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
