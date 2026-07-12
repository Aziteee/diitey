import type { ContentSnapshot } from "./snapshot.ts";

type WorkerResult =
  | { type: "ready" }
  | { type: "built"; snapshot: ContentSnapshot }
  | { type: "failed"; error: string };

export class SnapshotWorker {
  private worker: Worker | null = null;
  private ready: Promise<void>;
  private closed = false;

  private constructor(private readonly root: string) {
    this.ready = this.spawn();
  }

  static async create(root: string): Promise<SnapshotWorker> {
    const builder = new SnapshotWorker(root);
    await builder.ready;
    return builder;
  }

  async build(buildId: string, timeoutMs: number): Promise<ContentSnapshot> {
    await this.ready;
    const worker = this.worker;
    if (!worker) {
      throw new Error("Snapshot worker is unavailable");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        this.replace(worker);
        reject(new Error(`Reload timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type === "ready") {
          return;
        }
        clearTimeout(timer);
        if (event.data.type === "built") {
          resolve(freezeSnapshot(event.data.snapshot));
        } else {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        this.replace(worker);
        reject(new Error(event.message));
      };
      worker.postMessage({ type: "build", buildId });
    });
  }

  close(): void {
    this.closed = true;
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Snapshot worker is closed"));
    }
    const worker = new Worker(new URL("./snapshot-worker.ts", import.meta.url));
    this.worker = worker;

    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type === "ready") {
          resolve();
        } else if (event.data.type === "failed") {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ type: "initialize", root: this.root });
    });
  }

  private replace(worker: Worker): void {
    if (this.worker !== worker || this.closed) {
      return;
    }
    this.worker = null;
    this.ready = this.spawn();
    void this.ready.catch(() => undefined);
  }
}

function freezeSnapshot(snapshot: ContentSnapshot): ContentSnapshot {
  return Object.freeze({
    ...snapshot,
    islands: Object.freeze({
      manifest: Object.freeze({ ...snapshot.islands.manifest }),
      assets: Object.freeze(
        snapshot.islands.assets.map((asset) => Object.freeze({ ...asset })),
      ),
      runtimePath: snapshot.islands.runtimePath,
    }),
    pages: Object.freeze(
      snapshot.pages.map((page) => Object.freeze({
        ...page,
        ...(page.pagination
          ? {
              pagination: Object.freeze({
                ...page.pagination,
                bodies: Object.freeze([...page.pagination.bodies]),
              }),
            }
          : {}),
      })),
    ),
  });
}
