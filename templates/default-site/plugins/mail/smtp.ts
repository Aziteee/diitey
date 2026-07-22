export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string | null;
  readonly pass: string | null;
  readonly from: string;
  readonly sendTimeoutMs: number;
}

export interface SmtpMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string | null;
}

export async function sendSmtpMail(
  config: SmtpConfig,
  message: SmtpMessage,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("SMTP send aborted");
  }

  const timeout = AbortSignal.timeout(config.sendTimeoutMs);
  const combined =
    signal === undefined
      ? timeout
      : AbortSignal.any([signal, timeout]);

  const socket = await connectSmtp(config, combined);
  try {
    await runSmtpSession(socket, config, message, combined);
  } finally {
    socket.destroy();
  }
}

interface SmtpSocket {
  write(data: string): Promise<void>;
  readLine(): Promise<string>;
  destroy(): void;
}

async function connectSmtp(
  config: SmtpConfig,
  signal: AbortSignal,
): Promise<SmtpSocket> {
  const net = await import("node:net");
  const tls = await import("node:tls");

  if (config.secure) {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
    });
    await waitForConnect(socket, signal);
    return wrapNodeSocket(socket, signal);
  }

  const socket = net.connect({ host: config.host, port: config.port });
  await waitForConnect(socket, signal);
  return wrapNodeSocket(socket, signal);
}

function waitForConnect(
  socket: { once: (event: string, cb: (...args: unknown[]) => void) => void; destroy: () => void },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      socket.destroy();
      reject(new Error("SMTP send aborted"));
      return;
    }
    const onAbort = () => {
      socket.destroy();
      reject(new Error("SMTP send aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    socket.once("error", (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function wrapNodeSocket(
  socket: import("node:net").Socket | import("node:tls").TLSSocket,
  signal: AbortSignal,
): SmtpSocket {
  socket.setEncoding("utf8");
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];

  const failWaiters = (error: Error) => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(error);
    }
  };

  socket.on("data", (chunk: unknown) => {
    buffer += String(chunk);
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (waiters.length > 0) {
        waiters.shift()!.resolve(line);
      } else {
        lines.push(line);
      }
    }
  });

  socket.on("error", (error: unknown) => {
    failWaiters(error instanceof Error ? error : new Error(String(error)));
  });

  socket.on("close", () => {
    failWaiters(new Error("SMTP connection closed"));
  });

  signal.addEventListener(
    "abort",
    () => {
      socket.destroy();
      failWaiters(new Error("SMTP send aborted"));
    },
    { once: true },
  );

  return {
    async write(data: string) {
      if (signal.aborted) throw new Error("SMTP send aborted");
      await new Promise<void>((resolve, reject) => {
        socket.write(data, "utf8", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    readLine() {
      if (lines.length > 0) {
        return Promise.resolve(lines.shift()!);
      }
      if (signal.aborted) {
        return Promise.reject(new Error("SMTP send aborted"));
      }
      return new Promise<string>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    destroy() {
      socket.destroy();
    },
  };
}

async function runSmtpSession(
  socket: SmtpSocket,
  config: SmtpConfig,
  message: SmtpMessage,
  signal: AbortSignal,
): Promise<void> {
  await expectCode(socket, 220);

  await socket.write(`EHLO diitey\r\n`);
  await readEhlo(socket);

  if (config.user && config.pass) {
    await socket.write("AUTH LOGIN\r\n");
    await expectCode(socket, 334);
    await socket.write(`${base64(config.user)}\r\n`);
    await expectCode(socket, 334);
    await socket.write(`${base64(config.pass)}\r\n`);
    await expectCode(socket, 235);
  }

  const fromAddress = extractAddress(config.from);
  const toAddress = extractAddress(message.to);

  await socket.write(`MAIL FROM:<${fromAddress}>\r\n`);
  await expectCode(socket, 250);
  await socket.write(`RCPT TO:<${toAddress}>\r\n`);
  await expectCode(socket, 250);
  await socket.write("DATA\r\n");
  await expectCode(socket, 354);

  const payload = buildMime(config.from, message);
  await socket.write(payload);
  await expectCode(socket, 250);
  await socket.write("QUIT\r\n");
  try {
    await expectCode(socket, 221);
  } catch {
    // some servers close without 221
  }

  if (signal.aborted) {
    throw new Error("SMTP send aborted");
  }
}

async function readEhlo(socket: SmtpSocket): Promise<void> {
  for (;;) {
    const line = await socket.readLine();
    const code = Number(line.slice(0, 3));
    if (!Number.isFinite(code) || code !== 250) {
      throw new Error(`SMTP EHLO failed: ${line}`);
    }
    if (line[3] === " ") return;
    if (line[3] !== "-") {
      throw new Error(`SMTP EHLO failed: ${line}`);
    }
  }
}

async function expectCode(socket: SmtpSocket, code: number): Promise<string> {
  const line = await socket.readLine();
  const actual = Number(line.slice(0, 3));
  if (actual !== code) {
    throw new Error(`SMTP expected ${code}, got: ${line}`);
  }
  return line;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function extractAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return value.trim();
}

function buildMime(from: string, message: SmtpMessage): string {
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (message.replyTo) {
    lines.push(`Reply-To: ${message.replyTo}`);
  }
  lines.push("", dotStuff(message.text), ".");
  return `${lines.join("\r\n")}\r\n`;
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${base64(subject)}?=`;
}

function dotStuff(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}
