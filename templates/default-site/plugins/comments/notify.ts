export interface NotifyRecipient {
  readonly to: string;
  readonly kind: "owner" | "reply";
}

export interface CommentNotifyInput {
  readonly ownerEmail: string | null;
  readonly publicBaseUrl: string | null;
  readonly contentId: string;
  readonly contentTitle: string | null;
  readonly contentUrl: string | null;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly body: string;
  readonly isReply: boolean;
  /** Email of replyTo target if present, else root author when reply; null for root comments. */
  readonly replyTargetEmail: string | null;
}

export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo: string | null;
}

const BODY_PREVIEW_MAX = 500;

export function planCommentNotifications(
  input: CommentNotifyInput,
): OutboundMail[] {
  const recipients = new Map<string, NotifyRecipient>();

  if (input.ownerEmail) {
    addRecipient(recipients, input.ownerEmail, "owner");
  }

  if (input.isReply && input.replyTargetEmail) {
    addRecipient(recipients, input.replyTargetEmail, "reply");
  }

  const submitter = normalizeEmail(input.authorEmail);
  if (submitter) {
    recipients.delete(submitter);
  }

  const preview = truncateBody(input.body);
  const location = formatLocation(input);
  const mails: OutboundMail[] = [];

  for (const recipient of recipients.values()) {
    if (recipient.kind === "owner") {
      mails.push({
        to: recipient.to,
        subject: input.isReply
          ? `新回复：${location.title}`
          : `新评论：${location.title}`,
        text: [
          input.isReply ? "站点收到一条新回复。" : "站点收到一条新评论。",
          "",
          `内容：${location.title}`,
          location.link ? `链接：${location.link}` : null,
          `作者：${input.authorName}`,
          "",
          preview,
        ]
          .filter((line) => line !== null)
          .join("\n"),
        replyTo: input.authorEmail,
      });
    } else {
      mails.push({
        to: recipient.to,
        subject: `有人回复了你：${location.title}`,
        text: [
          `${input.authorName} 回复了你的评论。`,
          "",
          `内容：${location.title}`,
          location.link ? `链接：${location.link}` : null,
          "",
          preview,
        ]
          .filter((line) => line !== null)
          .join("\n"),
        replyTo: null,
      });
    }
  }

  return mails;
}

function addRecipient(
  map: Map<string, NotifyRecipient>,
  email: string,
  kind: "owner" | "reply",
): void {
  const key = normalizeEmail(email);
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { to: email.trim(), kind });
    return;
  }
  // Prefer owner template when both channels hit the same address.
  if (existing.kind === "reply" && kind === "owner") {
    map.set(key, { to: email.trim(), kind: "owner" });
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= BODY_PREVIEW_MAX) return normalized;
  return `${normalized.slice(0, BODY_PREVIEW_MAX)}…`;
}

function formatLocation(input: CommentNotifyInput): {
  title: string;
  link: string | null;
} {
  const title = input.contentTitle?.trim() || input.contentId;
  const path = input.contentUrl?.trim() || "";
  if (!path) {
    return { title, link: null };
  }
  if (/^https?:\/\//i.test(path)) {
    return { title, link: path };
  }
  const base = input.publicBaseUrl?.replace(/\/+$/, "") ?? null;
  if (!base) {
    return { title, link: path.startsWith("/") ? path : `/${path}` };
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return { title, link: `${base}${suffix}` };
}
