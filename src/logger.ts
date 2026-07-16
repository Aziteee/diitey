import { createRequire } from "node:module";
import type { Writable } from "node:stream";
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import type { PluginLogger } from "./index.ts";

export type LogLevelName = "error" | "warn" | "info";
export type { PluginLogger };
export { createSilentLogger } from "./silent-logger.ts";

export interface Logger extends PluginLogger {
  child(bindings: { readonly pluginId?: string }): Logger;
  /** Core-only structured fields; plugins use message-only methods. */
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevelName;
  readonly destination?: DestinationStream | Writable;
  readonly isTTY?: boolean;
}

const LEVEL_NAMES = new Set<string>(["error", "warn", "info"]);

export function parseLogLevel(
  value: string | undefined | null,
): LogLevelName {
  if (value === undefined || value === null || value === "") {
    return "info";
  }
  if (!LEVEL_NAMES.has(value)) {
    throw new Error(
      `Invalid DIITEY_LOG_LEVEL: ${value} (expected error, warn, or info)`,
    );
  }
  return value as LogLevelName;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? parseLogLevel(process.env.DIITEY_LOG_LEVEL);
  const isTTY =
    options.isTTY ??
    Boolean(
      typeof process.stdout !== "undefined" &&
        "isTTY" in process.stdout &&
        process.stdout.isTTY,
    );

  const pinoOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  let destination: DestinationStream | undefined;
  if (options.destination) {
    destination = options.destination as DestinationStream;
  } else if (isTTY) {
    // Sync pretty stream — transport workers are unreliable under Bun.
    const require = createRequire(import.meta.url);
    const pretty = require("pino-pretty") as (opts: object) => DestinationStream;
    destination = pretty({
      colorize: true,
      destination: 1,
      sync: true,
    });
  } else {
    destination = pino.destination({ dest: 1, sync: true });
  }

  return wrapPino(pino(pinoOptions, destination));
}

function wrapPino(instance: PinoLogger): Logger {
  return {
    info(message: string, fields?: Record<string, unknown>) {
      if (fields) instance.info(fields, message);
      else instance.info(message);
    },
    warn(message: string, fields?: Record<string, unknown>) {
      if (fields) instance.warn(fields, message);
      else instance.warn(message);
    },
    error(message: string, fields?: Record<string, unknown>) {
      if (fields) instance.error(fields, message);
      else instance.error(message);
    },
    child(bindings: { readonly pluginId?: string }) {
      const childBindings: Record<string, string> = {};
      if (bindings.pluginId !== undefined) {
        childBindings.pluginId = bindings.pluginId;
      }
      return wrapPino(instance.child(childBindings));
    },
  };
}
