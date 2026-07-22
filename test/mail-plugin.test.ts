import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import {
  buildPluginRuntime,
  callPluginService,
} from "../src/plugins.ts";
import mailPlugin from "../templates/default-site/plugins/mail/plugin.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("mail plugin", () => {
  test("mail.send delivers a plain-text message over SMTP", async () => {
    const received: string[] = [];
    const { port, done } = await startFakeSmtp(received);

    const definition = mailPlugin.setup({
      host: "127.0.0.1",
      port,
      secure: false,
      user: null,
      pass: null,
      from: "Site <noreply@example.com>",
      sendTimeoutMs: 3_000,
    });

    expect(definition.actions).toBeUndefined();
    expect(definition.services?.["mail.send"]).toBeDefined();

    const runtime = buildPluginRuntime([definition]);
    const result = await callPluginService(runtime, "mail.send", {
      to: "owner@example.com",
      subject: "新评论",
      text: "有人留言了。",
      replyTo: "visitor@example.com",
    });

    expect(result).toEqual({ sent: true });
    await done;
    const transcript = received.join("\n");
    expect(transcript).toContain("MAIL FROM:<noreply@example.com>");
    expect(transcript).toContain("RCPT TO:<owner@example.com>");
    expect(transcript).toContain("Subject:");
    expect(transcript).toContain("Reply-To: visitor@example.com");
    expect(transcript).toContain("有人留言了。");
  });

  test("mail.send rejects invalid recipient input", async () => {
    const definition = mailPlugin.setup({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      user: null,
      pass: null,
      from: "noreply@example.com",
      sendTimeoutMs: 1_000,
    });
    const runtime = buildPluginRuntime([definition]);

    await expect(
      callPluginService(runtime, "mail.send", {
        to: "not-an-email",
        subject: "x",
        text: "y",
      }),
    ).rejects.toThrow();
  });

  test("mail plugin config schema accepts defaults for optional fields", () => {
    const parsed = mailPlugin.config.parse({
      host: "smtp.example.com",
      port: 465,
      from: "a@b.c",
      secure: true,
    });
    expect(parsed.sendTimeoutMs).toBe(3_000);
    expect(parsed.user).toBeNull();
    expect(parsed.pass).toBeNull();
  });
});

function startFakeSmtp(received: string[]): Promise<{
  port: number;
  done: Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    let sessionDone!: () => void;
    const done = new Promise<void>((r) => {
      sessionDone = r;
    });

    const server = createServer((socket: Socket) => {
      let buffer = "";
      let stage:
        | "greeting"
        | "ehlo"
        | "mail"
        | "rcpt"
        | "data-wait"
        | "data"
        | "quit" = "greeting";

      socket.write("220 fake.smtp ready\r\n");
      stage = "ehlo";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        for (;;) {
          if (stage === "data") {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end < 0) return;
            const data = buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            received.push(data);
            socket.write("250 OK\r\n");
            stage = "quit";
            continue;
          }

          const index = buffer.indexOf("\r\n");
          if (index < 0) return;
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.push(line);

          if (stage === "ehlo" && /^EHLO\b/i.test(line)) {
            socket.write("250-fake.smtp\r\n250 OK\r\n");
            stage = "mail";
          } else if (stage === "mail" && /^MAIL FROM:/i.test(line)) {
            socket.write("250 OK\r\n");
            stage = "rcpt";
          } else if (stage === "rcpt" && /^RCPT TO:/i.test(line)) {
            socket.write("250 OK\r\n");
            stage = "data-wait";
          } else if (stage === "data-wait" && /^DATA$/i.test(line)) {
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
            stage = "data";
          } else if (stage === "quit" && /^QUIT$/i.test(line)) {
            socket.write("221 bye\r\n");
            socket.end();
            sessionDone();
          } else {
            socket.write("500 unexpected\r\n");
          }
        }
      });
    });

    servers.push(server);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind fake SMTP"));
        return;
      }
      resolve({ port: address.port, done });
    });
  });
}
