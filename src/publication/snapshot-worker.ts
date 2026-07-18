import "../preact-singleton.ts";
import type { BuiltIslands } from "../islands.ts";
import type { BuiltThemeStyles } from "../styles.ts";
import { buildContentSnapshot } from "./content-snapshot.ts";
import { buildPublicationCandidate } from "./effective-publication.ts";
import { compileSiteProgram, type SiteProgram } from "./site-program.ts";
import type { BuiltPluginAssets } from "./plugin-assets.ts";

type WorkerRequest =
  | {
      type: "initialize";
      root: string;
      programRevision: string;
      islands: BuiltIslands;
      styles: BuiltThemeStyles;
      pluginAssets: BuiltPluginAssets;
    }
  | { type: "build"; buildId: string };

let program: SiteProgram | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "initialize") {
      program = await compileSiteProgram(
        event.data.root,
        event.data.programRevision,
        {
          islands: event.data.islands,
          styles: event.data.styles,
          pluginAssets: event.data.pluginAssets,
        },
      );
      postMessage({
        type: "ready",
        programRevision: program.programRevision,
      });
      return;
    }
    if (!program) {
      throw new Error("Snapshot worker is not initialized");
    }

    const content = await buildContentSnapshot(program, event.data.buildId);
    const candidate = buildPublicationCandidate(program, content);
    postMessage({ type: "built", candidate });
  } catch (error) {
    postMessage({
      type: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
