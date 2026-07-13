import { describe, expect, test } from "bun:test";
import { createActionRateLimiter } from "../src/rate-limit.ts";

describe("Action rate limiter", () => {
  test("the same client and Action cannot exceed its fixed-window limit", () => {
    const rateLimiter = createActionRateLimiter({ maxKeys: 10 });
    const policy = { limit: 2, windowMs: 60_000 };

    expect(rateLimiter.consume("127.0.0.1:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("127.0.0.1:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("127.0.0.1:comments.create", policy)).toBe(false);
  });

  test("an ordinary consume check does not extend the fixed window", async () => {
    const rateLimiter = createActionRateLimiter({ maxKeys: 10 });
    const policy = { limit: 1, windowMs: 40 };

    expect(rateLimiter.consume("client:comments.create", policy)).toBe(true);
    await Bun.sleep(25);
    expect(rateLimiter.consume("client:comments.create", policy)).toBe(false);
    await Bun.sleep(25);
    expect(rateLimiter.consume("client:comments.create", policy)).toBe(true);
  });

  test("different Actions keep independent counters for the same client", () => {
    const rateLimiter = createActionRateLimiter({ maxKeys: 10 });
    const policy = { limit: 1, windowMs: 60_000 };

    expect(rateLimiter.consume("client:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("client:comments.create", policy)).toBe(false);
    expect(rateLimiter.consume("client:comments.delete", policy)).toBe(true);
  });

  test("the oldest key is evicted when the configured capacity is exceeded", () => {
    const rateLimiter = createActionRateLimiter({ maxKeys: 2 });
    const policy = { limit: 1, windowMs: 60_000 };

    expect(rateLimiter.consume("client-a:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("client-b:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("client-c:comments.create", policy)).toBe(true);
    expect(rateLimiter.consume("client-a:comments.create", policy)).toBe(true);
  });
});
