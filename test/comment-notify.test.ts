import { describe, expect, test } from "bun:test";
import { planCommentNotifications } from "../templates/default-site/plugins/comments/notify.ts";
import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  buildPluginRuntime,
  callPluginService,
  createContentLookup,
} from "../src/plugins.ts";
import type { ContentRecord, PluginDefinition } from "../src/index.ts";
import commentsPlugin from "../templates/default-site/plugins/comments/plugin.ts";

describe("comment notification planning", () => {
  test("root comment notifies owner only", () => {
    const mails = planCommentNotifications({
      ownerEmail: "owner@example.com",
      publicBaseUrl: "https://blog.example.com",
      contentId: "post-1",
      contentTitle: "你好世界",
      contentUrl: "/posts/hello",
      authorName: "访客",
      authorEmail: "guest@example.com",
      body: "写得好",
      isReply: false,
      replyTargetEmail: null,
    });

    expect(mails).toEqual([
      {
        to: "owner@example.com",
        subject: "新评论：你好世界",
        text: [
          "站点收到一条新评论。",
          "",
          "内容：你好世界",
          "链接：https://blog.example.com/posts/hello",
          "作者：访客",
          "",
          "写得好",
        ].join("\n"),
        replyTo: "guest@example.com",
      },
    ]);
  });

  test("reply notifies owner and reply target, deduped, skipping submitter", () => {
    const mails = planCommentNotifications({
      ownerEmail: "owner@example.com",
      publicBaseUrl: null,
      contentId: "post-1",
      contentTitle: null,
      contentUrl: "/p/1",
      authorName: "Bob",
      authorEmail: "bob@example.com",
      body: "re",
      isReply: true,
      replyTargetEmail: "alice@example.com",
    });

    expect(mails.map((m) => m.to).sort()).toEqual([
      "alice@example.com",
      "owner@example.com",
    ]);
    const replyMail = mails.find((m) => m.to === "alice@example.com")!;
    expect(replyMail.subject).toBe("有人回复了你：post-1");
    expect(replyMail.replyTo).toBeNull();
    expect(replyMail.text).toContain("链接：/p/1");
  });

  test("same address as owner and target yields one owner-style mail", () => {
    const mails = planCommentNotifications({
      ownerEmail: "same@example.com",
      publicBaseUrl: null,
      contentId: "c",
      contentTitle: "T",
      contentUrl: null,
      authorName: "X",
      authorEmail: "other@example.com",
      body: "hi",
      isReply: true,
      replyTargetEmail: "same@example.com",
    });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("same@example.com");
    expect(mails[0]!.subject.startsWith("新回复：")).toBe(true);
  });

  test("submitter does not receive their own notification", () => {
    const mails = planCommentNotifications({
      ownerEmail: "me@example.com",
      publicBaseUrl: null,
      contentId: "c",
      contentTitle: "T",
      contentUrl: null,
      authorName: "Me",
      authorEmail: "me@example.com",
      body: "self",
      isReply: false,
      replyTargetEmail: null,
    });
    expect(mails).toEqual([]);
  });

  test("body is truncated for mail preview", () => {
    const body = "字".repeat(600);
    const mails = planCommentNotifications({
      ownerEmail: "o@example.com",
      publicBaseUrl: null,
      contentId: "c",
      contentTitle: "T",
      contentUrl: null,
      authorName: "A",
      authorEmail: null,
      body,
      isReply: false,
      replyTargetEmail: null,
    });
    expect(mails[0]!.text.endsWith("…")).toBe(true);
    const preview = mails[0]!.text.split("\n").at(-1)!;
    expect(preview.length).toBe(501);
  });
});

describe("comments.create notification delivery", () => {
  test("create succeeds and calls mail.send for planned recipients", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const runtime = buildRuntimeWithMail(sent, {
      ownerEmail: "owner@example.com",
      publicBaseUrl: "https://example.com",
    });
    const database = openCommentsDb();
    const contentLookup = helloContentLookup();

    const created = (await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        authorName: "访客",
        email: "guest@example.com",
        body: "你好",
      },
      database,
      contentLookup,
    )) as { id: number; body: string };

    expect(created.body).toBe("你好");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "owner@example.com",
      subject: "新评论：Hello",
      replyTo: "guest@example.com",
    });
    expect(String(sent[0]!.text)).toContain(
      "链接：https://example.com/writing/hello",
    );
  });

  test("create still succeeds when mail.send fails", async () => {
    const runtime = buildRuntimeWithMail("fail", {
      ownerEmail: "owner@example.com",
      publicBaseUrl: null,
    });
    const database = openCommentsDb();
    const contentLookup = helloContentLookup();

    const created = (await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        authorName: "访客",
        body: "仍应入库",
      },
      database,
      contentLookup,
    )) as { body: string };

    expect(created.body).toBe("仍应入库");
    const row = database
      .query<{ body: string }, []>(`SELECT body FROM comments`)
      .get();
    expect(row?.body).toBe("仍应入库");
  });

  test("reply notifies reply target when email is stored", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const runtime = buildRuntimeWithMail(sent, {
      ownerEmail: null,
      publicBaseUrl: null,
    });
    const database = openCommentsDb();
    const contentLookup = helloContentLookup();

    const root = (await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        authorName: "Alice",
        email: "alice@example.com",
        body: "根评论",
      },
      database,
      contentLookup,
    )) as { id: number };

    sent.length = 0;

    await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        parentId: root.id,
        authorName: "Bob",
        email: "bob@example.com",
        body: "回复",
      },
      database,
      contentLookup,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "alice@example.com",
      subject: "有人回复了你：Hello",
      replyTo: null,
    });
  });

  test("replyTo without email falls back to root author email", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const runtime = buildRuntimeWithMail(sent, {
      ownerEmail: null,
      publicBaseUrl: null,
    });
    const database = openCommentsDb();
    const contentLookup = helloContentLookup();

    const root = (await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        authorName: "Alice",
        email: "alice@example.com",
        body: "根评论",
      },
      database,
      contentLookup,
    )) as { id: number };

    const reply = (await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        parentId: root.id,
        authorName: "Carol",
        body: "无邮箱回复",
      },
      database,
      contentLookup,
    )) as { id: number };

    sent.length = 0;

    await callPluginService(
      runtime,
      "comments.create",
      {
        contentId: "hello",
        parentId: root.id,
        replyToId: reply.id,
        authorName: "Dave",
        email: "dave@example.com",
        body: "@Carol",
      },
      database,
      contentLookup,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "alice@example.com",
      subject: "有人回复了你：Hello",
    });
  });
});

const mailSendSchemas = {
  input: z
    .object({
      to: z.string(),
      subject: z.string(),
      text: z.string(),
      replyTo: z.string().nullable().optional(),
    })
    .strict(),
  output: z.object({ sent: z.literal(true) }).strict(),
};

function buildRuntimeWithMail(
  sent: Array<Record<string, unknown>> | "fail",
  commentsConfig: {
    ownerEmail: string | null;
    publicBaseUrl: string | null;
  },
) {
  const comments = commentsPlugin.setup({
    maxBodyLength: 2000,
    maxAuthorNameLength: 40,
    ownerEmail: commentsConfig.ownerEmail,
    publicBaseUrl: commentsConfig.publicBaseUrl,
  });
  const mail: PluginDefinition = {
    id: "mail",
    version: "1.0.0",
    services: {
      "mail.send": {
        ...mailSendSchemas,
        handler(input) {
          if (sent === "fail") throw new Error("SMTP down");
          sent.push({ ...input });
          return { sent: true as const };
        },
      },
    },
  };
  return buildPluginRuntime([mail, comments]);
}

function helloContentLookup() {
  return createContentLookup(
    new Map([
      [
        "hello",
        {
          id: "hello",
          created: "2020-01-01T00:00:00.000Z",
          sourcePath: "hello.md",
          url: "/writing/hello",
          attributes: { title: "Hello" },
          html: "",
        } satisfies ContentRecord,
      ],
    ]),
  );
}

function openCommentsDb() {
  const database = new Database(":memory:");
  database.run(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL,
      parent_id INTEGER,
      reply_to_id INTEGER,
      author_name TEXT NOT NULL,
      email TEXT,
      website TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      client_address TEXT,
      user_agent TEXT
    );
  `);
  return database;
}
