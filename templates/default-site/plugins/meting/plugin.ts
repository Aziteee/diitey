import Meting from "@meting/core";
import { definePlugin, PluginNotFoundError } from "diitey";
import type { Database } from "bun:sqlite";
import { z } from "zod";

const providerSchema = z.enum(["netease", "tencent"]);
const songIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

const metingPluginConfig = z
  .object({
    metadataTtlMs: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 60 * 60 * 1_000)
      .optional()
      .default(7 * 24 * 60 * 60 * 1_000),
    streamTtlMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000)
      .optional()
      .default(10 * 60 * 1_000),
    defaultBitrate: z
      .number()
      .int()
      .min(24)
      .max(999)
      .optional()
      .default(320),
    neteaseCookie: z.string().optional().default(""),
    tencentCookie: z.string().optional().default(""),
  })
  .strict()
  .default({
    metadataTtlMs: 7 * 24 * 60 * 60 * 1_000,
    streamTtlMs: 10 * 60 * 1_000,
    defaultBitrate: 320,
    neteaseCookie: "",
    tencentCookie: "",
  });

export type MetingPluginConfig = z.infer<typeof metingPluginConfig>;
export type MusicProvider = z.infer<typeof providerSchema>;

export interface MusicSource {
  readonly provider: MusicProvider;
  readonly type: "song";
  readonly id: string;
}

interface MetingSong {
  readonly id: string | number;
  readonly name: string;
  readonly artist: readonly string[];
  readonly album?: string;
  readonly pic_id: string | number;
  readonly url_id: string | number;
}

interface MetingStream {
  readonly url: string;
  readonly size?: number;
  readonly br?: number;
}

interface MetingPicture {
  readonly url?: string;
}

export interface MetingClient {
  song(id: string): Promise<string>;
  url(id: string, bitrate: number): Promise<string>;
  pic(id: string, size: number): Promise<string>;
}

export type MetingClientFactory = (
  provider: MusicProvider,
  cookie: string,
) => MetingClient;

interface MetingDependencies {
  readonly createClient?: MetingClientFactory;
  readonly now?: () => number;
}

const metadataInput = z
  .object({
    auto: z
      .string()
      .trim()
      .url()
      .max(512)
      .refine(isSupportedMusicUrl, "unsupported music URL"),
  })
  .strict();

const metadataOutput = z
  .object({
    source: providerSchema,
    type: z.literal("song"),
    id: songIdSchema,
    title: z.string(),
    artist: z.string(),
    album: z.string().nullable(),
    artworkUrl: z.string().url().nullable(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

const streamInput = z
  .object({
    source: providerSchema,
    id: songIdSchema,
    bitrate: z.number().int().min(24).max(999).optional(),
  })
  .strict();

const streamOutput = z
  .object({
    audioUrl: z.string().url(),
    bitrate: z.number().int(),
    byteLength: z.number().int().nonnegative().nullable(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

type MetadataResult = z.infer<typeof metadataOutput>;
type StreamResult = z.infer<typeof streamOutput>;
type CacheTable = "meting_metadata_cache" | "meting_stream_cache";

interface CacheRow {
  readonly payload: string;
  readonly expiresAt: number;
}

export function parseMusicSource(raw: string): MusicSource {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("music URL must use http or https");
  }
  if (url.username || url.password || url.port) {
    throw new Error("music URL must not contain credentials or a custom port");
  }

  const host = url.hostname.toLowerCase();
  if (host === "y.qq.com") {
    const oldSong = /^\/n\/yqq\/song\/([A-Za-z0-9_-]+)\.html\/?$/.exec(
      url.pathname,
    );
    const currentSong =
      /^\/n\/ryqq(?:_v2)?\/songDetail\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      );
    const id = oldSong?.[1] ?? currentSong?.[1];
    if (id) return { provider: "tencent", type: "song", id };
  }

  if (host === "music.163.com") {
    const location = `${url.pathname}${url.search}${url.hash}`;
    const id = /(?:^|[?&#])id=(\d+)(?:&|$)/.exec(location)?.[1];
    if (id && /song/i.test(location)) {
      return { provider: "netease", type: "song", id };
    }
  }

  throw new Error("unsupported music URL");
}

export function createMetingDefinition(
  config: MetingPluginConfig,
  dependencies: MetingDependencies = {},
) {
  const createClient = dependencies.createClient ?? createDefaultClient;
  const now = dependencies.now ?? Date.now;
  const metadataInFlight = new Map<string, Promise<MetadataResult>>();
  const streamInFlight = new Map<string, Promise<StreamResult>>();

  return {
    id: "meting",
    name: "Meting music resolver",
    version: "1.0.0",
    schemaVersion: 1,
    migrations: [
      {
        id: "0001-create-meting-cache",
        schemaVersion: 1,
        sql: `
          CREATE TABLE meting_metadata_cache (
            cache_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX meting_metadata_cache_expiry_idx
            ON meting_metadata_cache (expires_at);

          CREATE TABLE meting_stream_cache (
            cache_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX meting_stream_cache_expiry_idx
            ON meting_stream_cache (expires_at);
        `,
      },
    ],
    services: {
      "meting.metadata": {
        input: metadataInput,
        output: metadataOutput,
        async handler(
          input: z.infer<typeof metadataInput>,
          { database, signal }: { database: Database; signal: AbortSignal },
        ) {
          const source = parseMusicSource(input.auto);
          const cacheKey = sourceKey(source);
          const cached = readCache<MetadataResult>(
            database,
            "meting_metadata_cache",
            cacheKey,
            now(),
            metadataOutput,
          );
          if (cached) return cached;

          const pending = coalesce(metadataInFlight, cacheKey, async () => {
            const rechecked = readCache<MetadataResult>(
              database,
              "meting_metadata_cache",
              cacheKey,
              now(),
              metadataOutput,
            );
            if (rechecked) return rechecked;

            const client = createClient(
              source.provider,
              cookieFor(source.provider, config),
            );
            const songs = parseJson<MetingSong[]>(
              await client.song(source.id),
              "song metadata",
            );
            const song = songs[0];
            if (!song) throw new PluginNotFoundError("music track does not exist");

            const picture = song.pic_id
              ? parseJson<MetingPicture>(
                  await client.pic(String(song.pic_id), 600),
                  "artwork",
                )
              : {};
            const expiresAt = now() + config.metadataTtlMs;
            const result: MetadataResult = {
              source: source.provider,
              type: "song",
              id: normalizeSongId(song.url_id, source.id),
              title: song.name,
              artist: song.artist.join(" / "),
              album: song.album?.trim() || null,
              artworkUrl: normalizeOptionalHttpsUrl(picture.url),
              expiresAt,
            };
            writeCache(database, "meting_metadata_cache", cacheKey, result, expiresAt);
            return result;
          });
          return abortable(pending, signal);
        },
      },
      "meting.stream": {
        input: streamInput,
        output: streamOutput,
        async handler(
          input: z.infer<typeof streamInput>,
          { database, signal }: { database: Database; signal: AbortSignal },
        ) {
          const bitrate = input.bitrate ?? config.defaultBitrate;
          const cacheKey = `${input.source}:song:${input.id}:${bitrate}`;
          const cached = readCache<StreamResult>(
            database,
            "meting_stream_cache",
            cacheKey,
            now(),
            streamOutput,
          );
          if (cached) return cached;

          const pending = coalesce(streamInFlight, cacheKey, async () => {
            const rechecked = readCache<StreamResult>(
              database,
              "meting_stream_cache",
              cacheKey,
              now(),
              streamOutput,
            );
            if (rechecked) return rechecked;

            const client = createClient(
              input.source,
              cookieFor(input.source, config),
            );
            const resolved = parseJson<MetingStream>(
              await client.url(input.id, bitrate),
              "stream URL",
            );
            if (!resolved.url) {
              throw new PluginNotFoundError("music stream is unavailable");
            }

            const expiresAt = now() + config.streamTtlMs;
            const result: StreamResult = {
              audioUrl: normalizeRequiredHttpsUrl(resolved.url),
              bitrate: Number.isInteger(resolved.br) ? resolved.br! : bitrate,
              byteLength:
                typeof resolved.size === "number" && resolved.size >= 0
                  ? Math.trunc(resolved.size)
                  : null,
              expiresAt,
            };
            writeCache(database, "meting_stream_cache", cacheKey, result, expiresAt);
            return result;
          });
          return abortable(pending, signal);
        },
      },
    },
    actions: {
      "meting.metadata": {
        service: "meting.metadata",
        bodyLimitBytes: 1_024,
        rateLimit: { limit: 60, windowMs: 60_000 },
        timeoutMs: 8_000,
      },
      "meting.stream": {
        service: "meting.stream",
        bodyLimitBytes: 512,
        rateLimit: { limit: 30, windowMs: 60_000 },
        timeoutMs: 8_000,
      },
    },
  } as const;
}

export default definePlugin({
  config: metingPluginConfig,
  setup(config) {
    return createMetingDefinition(config);
  },
});

function isSupportedMusicUrl(raw: string): boolean {
  try {
    parseMusicSource(raw);
    return true;
  } catch {
    return false;
  }
}

function createDefaultClient(provider: MusicProvider, cookie: string): MetingClient {
  const meting = new Meting(provider);
  meting.format(true);
  if (cookie) meting.cookie(cookie);
  return meting;
}

function cookieFor(provider: MusicProvider, config: MetingPluginConfig): string {
  return provider === "tencent" ? config.tencentCookie : config.neteaseCookie;
}

function sourceKey(source: MusicSource): string {
  return `${source.provider}:${source.type}:${source.id}`;
}

function normalizeSongId(value: string | number, fallback: string): string {
  const normalized = String(value).trim();
  return songIdSchema.safeParse(normalized).success ? normalized : fallback;
}

function parseJson<Value>(raw: string, label: string): Value {
  try {
    return JSON.parse(raw) as Value;
  } catch {
    throw new Error(`Meting returned invalid ${label}`);
  }
}

function normalizeOptionalHttpsUrl(raw: string | undefined): string | null {
  return raw ? normalizeRequiredHttpsUrl(raw) : null;
}

function normalizeRequiredHttpsUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") {
    throw new Error("Meting returned a non-HTTP media URL");
  }
  return url.toString();
}

function readCache<Value>(
  database: Database,
  table: CacheTable,
  key: string,
  currentTime: number,
  schema: z.ZodType<Value>,
): Value | undefined {
  const row = database
    .query<CacheRow, [string]>(
      `SELECT payload, expires_at AS expiresAt FROM ${table} WHERE cache_key = ?`,
    )
    .get(key);
  if (!row) return undefined;
  if (row.expiresAt <= currentTime) {
    database.query(`DELETE FROM ${table} WHERE cache_key = ?`).run(key);
    return undefined;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(row.payload));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid JSON is handled like any other incompatible cache payload.
  }
  database.query(`DELETE FROM ${table} WHERE cache_key = ?`).run(key);
  return undefined;
}

function writeCache<Value>(
  database: Database,
  table: CacheTable,
  key: string,
  value: Value,
  expiresAt: number,
): void {
  database
    .query(
      `INSERT INTO ${table} (cache_key, payload, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         expires_at = excluded.expires_at`,
    )
    .run(key, JSON.stringify(value), expiresAt);
}

async function coalesce<Value>(
  requests: Map<string, Promise<Value>>,
  key: string,
  load: () => Promise<Value>,
): Promise<Value> {
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = load().finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

function abortable<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<Value>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}
