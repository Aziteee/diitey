import type { BuiltIslands } from "../islands.ts";
import type { PublicationCandidate } from "./effective-publication.ts";

type WorkerResult =
  | { type: "ready"; programRevision: string }
  | { type: "built"; candidate: PublicationCandidate }
  | { type: "failed"; error: string };

const WORKER_UNAVAILABLE =
  "Extension build process unavailable; restart the site";

export class SnapshotWorker {
  private worker: Worker | null = null;
  private ready: Promise<void>;
  private closed = false;
  private unavailable = false;
  private unavailableError = WORKER_UNAVAILABLE;

  private constructor(
    private readonly root: string,
    private readonly programRevision: string,
    private readonly islands: BuiltIslands,
  ) {
    this.ready = this.spawn();
  }

  static async create(
    root: string,
    programRevision: string,
    islands: BuiltIslands,
  ): Promise<SnapshotWorker> {
    const builder = new SnapshotWorker(root, programRevision, islands);
    await builder.ready;
    return builder;
  }

  async build(
    buildId: string,
    timeoutMs: number,
  ): Promise<PublicationCandidate> {
    if (this.unavailable || this.closed) {
      throw new Error(this.unavailableError);
    }
    await this.ready;
    if (this.unavailable || this.closed) {
      throw new Error(this.unavailableError);
    }
    const worker = this.worker;
    if (!worker) {
      this.markUnavailable(WORKER_UNAVAILABLE);
      throw new Error(this.unavailableError);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        this.markUnavailable(
          `Reload timed out after ${timeoutMs}ms. ${WORKER_UNAVAILABLE}`,
        );
        reject(new Error(this.unavailableError));
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type === "ready") {
          return;
        }
        clearTimeout(timer);
        if (event.data.type === "built") {
          const candidate = event.data.candidate;
          if (candidate.programRevision !== this.programRevision) {
            this.markUnavailable(
              `Snapshot programRevision mismatch. ${WORKER_UNAVAILABLE}`,
            );
            reject(new Error(this.unavailableError));
            return;
          }
          resolve(candidate);
        } else {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        this.markUnavailable(`${event.message}. ${WORKER_UNAVAILABLE}`);
        reject(new Error(this.unavailableError));
      };
      worker.postMessage({ type: "build", buildId });
    });
  }

  close(): void {
    this.closed = true;
    this.worker?.terminate();
    this.worker = null;
  }

  private markUnavailable(error: string): void {
    this.unavailable = true;
    this.unavailableError = error;
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Snapshot worker is closed"));
    }
    const worker = new Worker(
      new URL("./snapshot-worker.ts", import.meta.url),
    );
    this.worker = worker;

    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type === "ready") {
          if (event.data.programRevision !== this.programRevision) {
            worker.terminate();
            this.worker = null;
            reject(
              new Error(
                "Snapshot worker programRevision does not match the startup site program",
              ),
            );
            return;
          }
          resolve();
        } else if (event.data.type === "failed") {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({
        type: "initialize",
        root: this.root,
        programRevision: this.programRevision,
        islands: this.islands,
      });
    });
  }
}
