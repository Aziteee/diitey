import { definePlugin } from "diitey";
import { z } from "zod";
import { sendSmtpMail } from "./smtp.ts";

const mailPluginConfig = z
  .object({
    host: z.string().trim().min(1),
    port: z.number().int().positive().max(65_535),
    secure: z.boolean().optional().default(false),
    user: z
      .union([z.string().trim().min(1), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value == null ? null : value)),
    pass: z
      .union([z.string(), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value == null ? null : value)),
    from: z.string().trim().min(1),
    /** Independent deadline for a single SMTP session (ms). */
    sendTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(60_000)
      .optional()
      .default(3_000),
  })
  .strict();

export type MailPluginConfig = z.infer<typeof mailPluginConfig>;

const sendInput = z
  .object({
    to: z.string().trim().email().max(254),
    subject: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(50_000),
    replyTo: z
      .union([z.string().trim().email().max(254), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value == null ? null : value)),
  })
  .strict();

const sendOutput = z
  .object({
    sent: z.literal(true),
  })
  .strict();

export default definePlugin({
  config: mailPluginConfig,
  setup(config) {
    return {
      id: "mail",
      name: "Mail",
      version: "1.0.0",
      services: {
        "mail.send": {
          input: sendInput,
          output: sendOutput,
          async handler(input, { signal }) {
            await sendSmtpMail(
              {
                host: config.host,
                port: config.port,
                secure: config.secure,
                user: config.user ?? null,
                pass: config.pass ?? null,
                from: config.from,
                sendTimeoutMs: config.sendTimeoutMs,
              },
              {
                to: input.to,
                subject: input.subject,
                text: input.text,
                replyTo: input.replyTo,
              },
              signal,
            );
            return { sent: true as const };
          },
        },
      },
      // No public Action: mail.send is only for plugin service invocation.
    };
  },
});
