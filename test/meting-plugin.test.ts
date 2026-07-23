import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildPluginRuntime,
  callPluginService,
  PluginInputError,
} from "../src/plugins.ts";
import metingPlugin, {
  createMetingDefinition,
  type MetingClient,
  type MetingClientFactory,
  parseMusicSource,
} from "../templates/default-site/plugins/meting/plugin.ts";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("meting plugin", () => {
  test("parses supported Tencent and NetEase song URLs without accepting lookalike hosts", () => {
    expect(
      parseMusicSource(
        "https://y.qq.com/n/yqq/song/001RGrEX3ija5X.html",
      ),
    ).toEqual({
      provider: "tencent",
      type: "song",
      id: "001RGrEX3ija5X",
    });
    expect(
      parseMusicSource(
        "https://y.qq.com/n/ryqq_v2/songDetail/001RGrEX3ija5X",
      ),
    ).toEqual({
      provider: "tencent",
      type: "song",
      id: "001RGrEX3ija5X",
    });
    expect(
      parseMusicSource("https://music.163.com/#/song?id=35847388"),
    ).toEqual({ provider: "netease", type: "song", id: "35847388" });
    expect(() =>
      parseMusicSource(
        "https://evil.example/?next=https://y.qq.com/n/yqq/song/001RGrEX3ija5X.html",
      ),
    ).toThrow("unsupported music URL");
  });

  test("metadata and stream services use independent long and short caches", async () => {
    let currentTime = 1_000_000;
    const calls = { song: 0, pic: 0, url: 0 };
    const factory: MetingClientFactory = () => fakeClient(calls);
    const definition = createMetingDefinition(
      {
        metadataTtlMs: 60_000,
        streamTtlMs: 5_000,
        defaultBitrate: 320,
        neteaseCookie: "",
        tencentCookie: "",
      },
      { createClient: factory, now: () => currentTime },
    );
    const database = migratedDatabase(definition);
    const runtime = buildPluginRuntime([definition]);
    const auto = "https://y.qq.com/n/yqq/song/001RGrEX3ija5X.html";

    const firstMetadata = await callPluginService(
      runtime,
      "meting.metadata",
      { auto },
      database,
    );
    const secondMetadata = await callPluginService(
      runtime,
      "meting.metadata",
      { auto },
      database,
    );
    expect(secondMetadata).toEqual(firstMetadata);
    expect(firstMetadata).toEqual({
      source: "tencent",
      type: "song",
      id: "001RGrEX3ija5X",
      title: "星",
      artist: "杨宗纬",
      album: "星",
      artworkUrl: "https://img.example/cover.jpg",
      expiresAt: 1_060_000,
    });
    expect(calls.song).toBe(1);
    expect(calls.pic).toBe(1);

    const streamInput = {
      source: "tencent",
      id: "001RGrEX3ija5X",
    };
    const firstStream = await callPluginService(
      runtime,
      "meting.stream",
      streamInput,
      database,
    );
    const secondStream = await callPluginService(
      runtime,
      "meting.stream",
      streamInput,
      database,
    );
    expect(secondStream).toEqual(firstStream);
    expect(firstStream).toEqual({
      audioUrl: "https://audio.example/song.mp3?token=short-lived",
      bitrate: 128,
      byteLength: 4_072_780,
      expiresAt: 1_005_000,
    });
    expect(calls.url).toBe(1);

    currentTime += 5_001;
    await callPluginService(
      runtime,
      "meting.stream",
      streamInput,
      database,
    );
    await callPluginService(runtime, "meting.metadata", { auto }, database);
    expect(calls.url).toBe(2);
    expect(calls.song).toBe(1);
  });

  test("public actions expose the two services with bounded request policies", () => {
    const config = metingPlugin.config.parse(undefined);
    const definition = metingPlugin.setup(config);
    const runtime = buildPluginRuntime([definition]);

    expect(runtime.actions["meting.metadata"]).toMatchObject({
      service: "meting.metadata",
      bodyLimitBytes: 1_024,
      timeoutMs: 8_000,
    });
    expect(runtime.actions["meting.stream"]).toMatchObject({
      service: "meting.stream",
      bodyLimitBytes: 512,
      timeoutMs: 8_000,
    });
  });

  test("metadata service rejects unsupported auto URLs before calling Meting", async () => {
    const definition = createMetingDefinition(
      metingPlugin.config.parse(undefined),
      {
        createClient() {
          throw new Error("must not create a client");
        },
      },
    );
    const database = migratedDatabase(definition);
    const runtime = buildPluginRuntime([definition]);

    await expect(
      callPluginService(
        runtime,
        "meting.metadata",
        { auto: "https://evil.example/song/123" },
        database,
      ),
    ).rejects.toBeInstanceOf(PluginInputError);
  });

  test("metadata normalizes numeric NetEase song identifiers to strings", async () => {
    const definition = createMetingDefinition(
      metingPlugin.config.parse(undefined),
      {
        createClient() {
          return {
            async song() {
              return JSON.stringify([
                {
                  id: 2635783358,
                  name: "网易云测试歌曲",
                  artist: ["测试歌手"],
                  album: "测试专辑",
                  pic_id: 109951170048506929,
                  url_id: 2635783358,
                },
              ]);
            },
            async pic() {
              return JSON.stringify({ url: "https://img.example/netease.jpg" });
            },
            async url() {
              throw new Error("metadata must not resolve the stream URL");
            },
          };
        },
      },
    );
    const database = migratedDatabase(definition);
    const runtime = buildPluginRuntime([definition]);

    const result = await callPluginService(
      runtime,
      "meting.metadata",
      { auto: "https://music.163.com/#/song?id=2635783358" },
      database,
    );
    expect(result).toMatchObject({
      source: "netease",
      id: "2635783358",
      artworkUrl: "https://img.example/netease.jpg",
    });
  });

  test("metadata discards an incompatible cached identifier", async () => {
    let songCalls = 0;
    const definition = createMetingDefinition(
      metingPlugin.config.parse(undefined),
      {
        now: () => 1_000,
        createClient() {
          return {
            async song() {
              songCalls += 1;
              return JSON.stringify([
                {
                  id: 2635783358,
                  name: "缓存恢复测试",
                  artist: ["测试歌手"],
                  album: "测试专辑",
                  pic_id: "109951170048506929",
                  url_id: "2635783358",
                },
              ]);
            },
            async pic() {
              return JSON.stringify({ url: "https://img.example/netease.jpg" });
            },
            async url() {
              throw new Error("metadata must not resolve the stream URL");
            },
          };
        },
      },
    );
    const database = migratedDatabase(definition);
    database
      .query(
        `INSERT INTO meting_metadata_cache (cache_key, payload, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(
        "netease:song:2635783358",
        JSON.stringify({
          source: "netease",
          type: "song",
          id: 2635783358,
          title: "旧缓存",
          artist: "测试歌手",
          album: null,
          artworkUrl: null,
          expiresAt: 2_000,
        }),
        2_000,
      );
    const runtime = buildPluginRuntime([definition]);

    const result = await callPluginService(
      runtime,
      "meting.metadata",
      { auto: "https://music.163.com/#/song?id=2635783358" },
      database,
    );
    expect(result).toMatchObject({ id: "2635783358", title: "缓存恢复测试" });
    expect(songCalls).toBe(1);
  });
});

function fakeClient(calls: {
  song: number;
  pic: number;
  url: number;
}): MetingClient {
  return {
    async song() {
      calls.song += 1;
      return JSON.stringify([
        {
          id: "001RGrEX3ija5X",
          name: "星",
          artist: ["杨宗纬"],
          album: "星",
          pic_id: "003jZxLY2aUYIk",
          url_id: "001RGrEX3ija5X",
        },
      ]);
    },
    async pic() {
      calls.pic += 1;
      return JSON.stringify({ url: "http://img.example/cover.jpg" });
    },
    async url() {
      calls.url += 1;
      return JSON.stringify({
        url: "http://audio.example/song.mp3?token=short-lived",
        size: 4_072_780,
        br: 128,
      });
    },
  };
}

function migratedDatabase(
  definition: ReturnType<typeof createMetingDefinition>,
): Database {
  const database = new Database(":memory:");
  databases.push(database);
  for (const migration of definition.migrations) database.run(migration.sql);
  return database;
}
