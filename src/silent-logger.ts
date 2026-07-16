import type { Logger } from "./logger.ts";

const silent: Logger = {
  info() {},
  warn() {},
  error() {},
  child() {
    return silent;
  },
};

/**
 * No-op logger for call sites that omit process logging (tests, optional wiring).
 * Kept free of Pino so modules that only need a default can avoid the logging stack.
 */
export function createSilentLogger(): Logger {
  return silent;
}
