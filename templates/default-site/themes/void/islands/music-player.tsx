import WaveformPlayer from "@arraypress/waveform-player";
import { useEffect } from "preact/hooks";

interface MusicMetadata {
  readonly source: "netease" | "tencent";
  readonly type: "song";
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkUrl: string | null;
  readonly expiresAt: number;
}

interface MusicStream {
  readonly audioUrl: string;
  readonly bitrate: number;
  readonly byteLength: number | null;
  readonly expiresAt: number;
}

const selector = "music-player[auto], [data-diitey-music-player][data-auto]";

export default function MusicPlayerActivator() {
  useEffect(() => {
    const controller = new AbortController();
    const players: WaveformPlayer[] = [];
    const metadataRequests = new Map<string, Promise<MusicMetadata>>();
    const streamRequests = new Map<string, Promise<MusicStream>>();
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).filter((element, index, all) => all.indexOf(element) === index);

    const enhance = (element: HTMLElement) => {
      if (element.dataset.diiteyMusicState) return;
      const auto = element.getAttribute("auto") ?? element.dataset.auto;
      if (!auto) return;
      element.dataset.diiteyMusicState = "loading";
      element.setAttribute("aria-busy", "true");
      setStatus(element, "正在读取歌曲信息…");

      const metadataRequest = loadOnce(metadataRequests, auto, () =>
        loadMetadata(auto, controller.signal),
      );
      void metadataRequest
        .then(async (metadata) => {
          if (controller.signal.aborted) return;
          setStatus(
            element,
            metadata.artist
              ? `${metadata.title} — ${metadata.artist}`
              : metadata.title,
          );
          const streamKey = `${metadata.source}:${metadata.id}`;
          const stream = await loadOnce(streamRequests, streamKey, () =>
            loadStream(metadata, controller.signal),
          );
          if (controller.signal.aborted) return;
          element.replaceChildren();
          element.removeAttribute("aria-busy");
          element.dataset.diiteyMusicState = "ready";
          players.push(
            new WaveformPlayer(element, {
              url: stream.audioUrl,
              title: metadata.title,
              artist: metadata.artist,
              artwork: metadata.artworkUrl ?? undefined,
              waveformStyle: "mirror",
              showBPM: true,
              crossOrigin: "anonymous",
              preload: "metadata",
            }),
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          element.removeAttribute("aria-busy");
          element.dataset.diiteyMusicState = "error";
          setStatus(
            element,
            error instanceof Error ? `音乐加载失败：${error.message}` : "音乐加载失败",
          );
        });
    };

    let observer: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            enhance(entry.target as HTMLElement);
          }
        },
        { rootMargin: "320px 0px" },
      );
      for (const element of elements) observer.observe(element);
    } else {
      for (const element of elements) enhance(element);
    }

    return () => {
      observer?.disconnect();
      controller.abort();
      for (const player of players) player.destroy();
      metadataRequests.clear();
      streamRequests.clear();
    };
  }, []);

  return null;
}

function loadOnce<Value>(
  requests: Map<string, Promise<Value>>,
  key: string,
  load: () => Promise<Value>,
): Promise<Value> {
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = load();
  requests.set(key, pending);
  return pending;
}

async function loadMetadata(
  auto: string,
  signal: AbortSignal,
): Promise<MusicMetadata> {
  return postJson<MusicMetadata>("/_action/meting.metadata", { auto }, signal);
}

async function loadStream(
  metadata: MusicMetadata,
  signal: AbortSignal,
): Promise<MusicStream> {
  return postJson<MusicStream>(
    "/_action/meting.stream",
    { source: metadata.source, id: metadata.id },
    signal,
  );
}

async function postJson<Value>(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Value> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("未找到可播放音源");
    if (response.status === 429) throw new Error("请求过于频繁");
    throw new Error(`服务返回 ${response.status}`);
  }
  return (await response.json()) as Value;
}

function setStatus(element: HTMLElement, text: string): void {
  const status = document.createElement("span");
  status.className = "music-player-status";
  status.textContent = text;
  element.replaceChildren(status);
}
