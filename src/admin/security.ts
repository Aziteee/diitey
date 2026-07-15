import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_TOKEN_MIN_BYTES = 32;
export const ADMIN_SESSION_COOKIE = "diitey_admin";
export const ADMIN_CSRF_COOKIE = "diitey_csrf";
export const ADMIN_COOKIE_PATH = "/_admin";
export const LOGIN_BODY_LIMIT_BYTES = 8 * 1024;
export const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;

export interface AdminSecurityConfig {
  readonly enabled: boolean;
  readonly token: string | null;
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
}

export function parsePublicOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid origin URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${label} must contain only scheme, host, and optional port`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.origin;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  );
}

export function resolveAdminSecurity(options: {
  readonly adminToken: string | null;
  readonly publicOrigin: string | null;
  readonly host: string;
  readonly boundOrigin?: string;
}): AdminSecurityConfig {
  const token = options.adminToken;
  if (token !== null) {
    const byteLength = Buffer.byteLength(token, "utf8");
    if (byteLength < ADMIN_TOKEN_MIN_BYTES) {
      throw new Error(
        `Admin token must be at least ${ADMIN_TOKEN_MIN_BYTES} UTF-8 bytes (got ${byteLength}). Generate a high-entropy random token.`,
      );
    }
  }

  const enabled = token !== null;
  let publicOrigin = options.publicOrigin;

  if (enabled) {
    if (!publicOrigin) {
      if (!isLoopbackHost(options.host) && options.host !== "0.0.0.0") {
        throw new Error(
          "Admin is enabled with a non-loopback host; set --public-origin or DIITEY_PUBLIC_ORIGIN",
        );
      }
      if (options.host === "0.0.0.0") {
        throw new Error(
          "Admin is enabled while listening on 0.0.0.0; set an explicit --public-origin or DIITEY_PUBLIC_ORIGIN",
        );
      }
      if (!options.boundOrigin) {
        throw new Error(
          "Admin is enabled without public origin and no bound origin is available",
        );
      }
      publicOrigin = options.boundOrigin;
    }

    const originUrl = new URL(publicOrigin);
    const loopback = isLoopbackHost(originUrl.hostname);
    if (!loopback && originUrl.protocol !== "https:") {
      throw new Error(
        "Admin requires HTTPS public origin when the public origin host is not loopback",
      );
    }
  } else if (!publicOrigin) {
    publicOrigin = options.boundOrigin ?? "http://127.0.0.1";
  }

  const originUrl = new URL(publicOrigin);
  return Object.freeze({
    enabled,
    token,
    publicOrigin: originUrl.origin,
    secureCookies: originUrl.protocol === "https:",
  });
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    const filler = Buffer.alloc(left.length);
    timingSafeEqual(left, filler);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function deriveSessionMacKey(adminToken: string): Buffer {
  return new Bun.CryptoHasher("sha256")
    .update("diitey-admin-session-v1:")
    .update(adminToken)
    .digest();
}

export function createSessionToken(
  adminToken: string,
  nowMs: number = Date.now(),
  nonce: string = crypto.randomUUID(),
): string {
  const issuedAt = nowMs;
  const expiresAt = nowMs + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ issuedAt, expiresAt, nonce }),
    "utf8",
  ).toString("base64url");
  const mac = signPayload(payload, adminToken);
  return `v1.${payload}.${mac}`;
}

export function verifySessionToken(
  value: string,
  adminToken: string,
  nowMs: number = Date.now(),
): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, payload, mac] = parts;
  if (!payload || !mac) return false;
  const expected = signPayload(payload, adminToken);
  if (!constantTimeEqual(mac, expected)) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      issuedAt?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
    };
    if (
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string"
    ) {
      return false;
    }
    if (parsed.expiresAt <= nowMs) return false;
    if (parsed.issuedAt > nowMs + 60_000) return false;
    return true;
  } catch {
    return false;
  }
}

function signPayload(payload: string, adminToken: string): string {
  const key = deriveSessionMacKey(adminToken);
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createCsrfToken(): string {
  return crypto.randomUUID();
}
