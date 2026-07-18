import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Pluggable } from "unified";

export interface ContentResource {
  readonly publicPath: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly cachePath: string;
}

interface ContentResourceArtifact {
  readonly digest: string;
  readonly byteLength: number;
  readonly cachePath: string;
}

export type Artifact = ContentResourceArtifact;

/** Shared content-addressed artifact materialization for publication assets. */
export class ArtifactStore {
  private readonly artifactsByRealPath = new Map<string, Promise<Artifact>>();

  constructor(private readonly cacheRoot: string) {}

  materialize(realPath: string): Promise<Artifact> {
    const existing = this.artifactsByRealPath.get(realPath);
    if (existing) return existing;
    const pending = this.copy(realPath);
    this.artifactsByRealPath.set(realPath, pending);
    return pending;
  }

  private async copy(realPath: string): Promise<Artifact> {
    const temporaryPath = resolve(this.cacheRoot, `.tmp-${crypto.randomUUID()}`);
    const digest = createHash("sha256");
    let byteLength = 0;
    try {
      await pipeline(
        createReadStream(realPath),
        new Transform({
          transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
            digest.update(chunk);
            byteLength += chunk.byteLength;
            callback(null, chunk);
          },
        }),
        createWriteStream(temporaryPath, { flags: "wx" }),
      );
      const hash = digest.digest("hex");
      const finalizedPath = resolve(this.cacheRoot, hash);
      try {
        await rename(temporaryPath, finalizedPath);
      } catch (error) {
        try {
          await stat(finalizedPath);
        } catch {
          throw error;
        }
        await rm(temporaryPath, { force: true });
      }
      return Object.freeze({ digest: hash, byteLength, cachePath: finalizedPath });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

interface MarkdownNode {
  readonly type?: unknown;
  url?: unknown;
  readonly identifier?: unknown;
  readonly children?: readonly MarkdownNode[];
}

const contentUrlMarker = "/__diitey_content_root__/";
const immutableDigestPattern = /^[a-f0-9]{64}$/;
const temporaryArtifactPattern = /^\.tmp-[a-f0-9-]+$/;
const oneDayMs = 24 * 60 * 60 * 1_000;

export async function createContentResourceBuilder(options: {
  readonly contentRoot: string;
  readonly cacheRoot: string;
}): Promise<ContentResourceBuilder> {
  const [realContentRoot] = await Promise.all([
    realpath(options.contentRoot),
    mkdir(options.cacheRoot, { recursive: true }),
  ]);
  return new ContentResourceBuilder(
    realContentRoot,
    resolve(options.contentRoot),
    new ArtifactStore(resolve(options.cacheRoot)),
  );
}

export function contentResourceCacheRoot(root: string): string {
  return resolve(root, "data", "cache", "content-assets");
}

export class ContentResourceBuilder {
  private readonly resourcesByPublicPath = new Map<string, ContentResource>();

  constructor(
    private readonly realContentRoot: string,
    private readonly contentRoot: string,
    private readonly artifactStore: ArtifactStore,
  ) {}

  remarkPlugin(sourceFilePath: string): Pluggable {
    return () => async (tree: unknown) => {
      await this.rewriteNativeMarkdownUrls(tree, sourceFilePath);
    };
  }

  get resources(): readonly ContentResource[] {
    return Object.freeze(
      [...this.resourcesByPublicPath.values()]
        .sort((left, right) => left.publicPath.localeCompare(right.publicPath))
        .map(freezeContentResource),
    );
  }

  private async rewriteNativeMarkdownUrls(
    tree: unknown,
    sourceFilePath: string,
  ): Promise<void> {
    const nodes = walkMarkdownTree(tree);
    const usedDefinitions = new Set<string>();
    const definitions = new Map<string, MarkdownNode>();
    const destinations: MarkdownNode[] = [];

    for (const node of nodes) {
      if (node.type === "link" || node.type === "image") {
        destinations.push(node);
      } else if (
        (node.type === "linkReference" || node.type === "imageReference") &&
        typeof node.identifier === "string"
      ) {
        usedDefinitions.add(node.identifier);
      } else if (
        node.type === "definition" &&
        typeof node.identifier === "string"
      ) {
        if (!definitions.has(node.identifier)) {
          definitions.set(node.identifier, node);
        }
      }
    }

    for (const definitionIdentifier of usedDefinitions) {
      const definition = definitions.get(definitionIdentifier);
      if (definition) destinations.push(definition);
    }

    await Promise.all(
      destinations.map(async (node) => {
        if (typeof node.url !== "string") return;
        node.url = await this.rewriteDestination(node.url, sourceFilePath);
      }),
    );
  }

  private async rewriteDestination(
    destination: string,
    sourceFilePath: string,
  ): Promise<string> {
    const candidate = this.resolveCandidate(destination, sourceFilePath);
    if (!candidate) return destination;

    const realTarget = await this.resolveEligibleTarget(candidate.targetPath);
    if (!realTarget) return destination;

    const artifact = await this.artifactStore.materialize(realTarget);
    const resource = freezeContentResource({
      publicPath: `/assets/content/${artifact.digest}/${encodeURIComponent(candidate.basename)}`,
      digest: artifact.digest,
      byteLength: artifact.byteLength,
      mediaType: mediaTypeFor(candidate.basename),
      cachePath: artifact.cachePath,
    });
    this.resourcesByPublicPath.set(resource.publicPath, resource);
    return `${resource.publicPath}${candidate.suffix}`;
  }

  private resolveCandidate(
    destination: string,
    sourceFilePath: string,
  ): { readonly targetPath: string; readonly basename: string; readonly suffix: string } | undefined {
    if (
      destination === "" ||
      destination.startsWith("/") ||
      destination.startsWith("\\") ||
      destination.startsWith("#") ||
      destination.startsWith("?") ||
      /^[a-z][a-z\d+.-]*:/i.test(destination)
    ) {
      return undefined;
    }

    const suffixIndex = destination.search(/[?#]/);
    const pathname =
      suffixIndex === -1 ? destination : destination.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? "" : destination.slice(suffixIndex);
    if (pathname === "") return undefined;

    const sourceRelativeDirectory = relative(
      this.contentRoot,
      dirname(sourceFilePath),
    ).replaceAll("\\", "/");
    if (
      sourceRelativeDirectory === ".." ||
      sourceRelativeDirectory.startsWith("../") ||
      isAbsolute(sourceRelativeDirectory)
    ) {
      return undefined;
    }

    let normalizedPath: string;
    try {
      const base = `https://content.invalid${contentUrlMarker}${sourceRelativeDirectory ? `${sourceRelativeDirectory}/` : ""}`;
      const parsed = new URL(pathname, base);
      if (!parsed.pathname.startsWith(contentUrlMarker)) return undefined;
      normalizedPath = decodeURIComponent(
        parsed.pathname.slice(contentUrlMarker.length),
      );
    } catch {
      return undefined;
    }
    if (normalizedPath.includes("\0") || normalizedPath === "") return undefined;

    const targetPath = resolve(
      this.contentRoot,
      ...normalizedPath.split("/").filter(Boolean),
    );
    if (!isWithin(this.contentRoot, targetPath)) return undefined;
    const originalBasename = basename(targetPath);
    if (originalBasename === "" || originalBasename === ".") return undefined;
    return { targetPath, basename: originalBasename, suffix };
  }

  private async resolveEligibleTarget(targetPath: string): Promise<string | undefined> {
    let realTarget: string;
    try {
      realTarget = await realpath(targetPath);
      if (!isWithin(this.realContentRoot, realTarget)) return undefined;
      const details = await stat(realTarget);
      if (!details.isFile()) return undefined;
      if ([".md", ".mdx"].includes(extname(realTarget).toLowerCase())) {
        return undefined;
      }
      await access(realTarget, constants.R_OK);
    } catch {
      return undefined;
    }
    return realTarget;
  }
}

export async function collectArtifactCache(options: {
  readonly cacheRoot: string;
  readonly referencedDigests: ReadonlySet<string>;
  readonly now?: number;
}): Promise<void> {
  const olderThan = (options.now ?? Date.now()) - oneDayMs;
  const entries = await readdir(options.cacheRoot, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const isFinalized = immutableDigestPattern.test(entry.name);
      const isTemporary = temporaryArtifactPattern.test(entry.name);
      if (!isTemporary && (!isFinalized || options.referencedDigests.has(entry.name))) {
        return;
      }
      const artifactPath = resolve(options.cacheRoot, entry.name);
      const details = await stat(artifactPath);
      if (details.mtimeMs > olderThan) return;
      await rm(artifactPath);
    }),
  );
}

/** @deprecated Use collectArtifactCache for new publication resource domains. */
export const collectContentResourceCache = collectArtifactCache;

function walkMarkdownTree(tree: unknown): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as MarkdownNode;
    if (typeof node.type === "string") nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return nodes;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function mediaTypeFor(filename: string): string {
  return Bun.file(filename).type;
}

function freezeContentResource(resource: ContentResource): ContentResource {
  return Object.freeze({ ...resource });
}
