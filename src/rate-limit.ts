import { LRUCache } from "lru-cache";

export interface ActionRateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export interface ActionRateLimiter {
  consume(key: string, policy: ActionRateLimitPolicy): boolean;
}

export function createActionRateLimiter(
  options: { readonly maxKeys?: number } = {},
): ActionRateLimiter {
  const entries = new LRUCache<string, { count: number }>({
    max: options.maxKeys ?? 10_000,
    ttlAutopurge: true,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
  });

  return Object.freeze({
    consume(key: string, policy: ActionRateLimitPolicy): boolean {
      const entry = entries.get(key);
      if (!entry) {
        entries.set(key, { count: 1 }, { ttl: policy.windowMs });
        return true;
      }
      if (entry.count >= policy.limit) return false;
      entry.count += 1;
      return true;
    },
  });
}
