import {
  buildContentSnapshot,
  loadPublishingContext,
  type PublishingContext,
} from "./snapshot.ts";

type WorkerRequest =
  | { type: "initialize"; root: string }
  | { type: "build"; buildId: string };

let context: PublishingContext | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "initialize") {
      context = await loadPublishingContext(event.data.root);
      postMessage({ type: "ready" });
      return;
    }
    if (!context) {
      throw new Error("Snapshot worker is not initialized");
    }

    const snapshot = await buildContentSnapshot(context, event.data.buildId);
    postMessage({ type: "built", snapshot });
  } catch (error) {
    postMessage({
      type: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
