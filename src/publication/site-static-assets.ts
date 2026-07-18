import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const CACHE_CONTROL = "public, max-age=0, must-revalidate";

export async function tryServeSiteStaticAsset(
  request: Request,
  siteRoot: string,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const resolved = await resolveSiteStaticFile(request, siteRoot);
  if (!resolved) return null;

  const file = Bun.file(resolved.realPath);
  if (!(await file.exists())) return null;

  const fileStat = await file.stat();
  const etag = weakEtag(fileStat.size, fileStat.mtimeMs);
  const lastModified = new Date(fileStat.mtimeMs).toUTCString();
  const contentType = mediaTypeFor(resolved.realPath);

  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-length": String(fileStat.size),
    etag,
    "last-modified": lastModified,
    "cache-control": CACHE_CONTROL,
    "x-content-type-options": "nosniff",
  };

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  const ifModifiedSince = request.headers.get("if-modified-since");
  if (
    ifModifiedSince &&
    !ifNoneMatch &&
    notModifiedSince(ifModifiedSince, fileStat.mtimeMs)
  ) {
    return new Response(null, { status: 304, headers });
  }

  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }
  return new Response(file, { headers });
}

export async function siteStaticAssetMethodNotAllowed(
  request: Request,
  siteRoot: string,
): Promise<Response | null> {
  const resolved = await resolveSiteStaticFile(request, siteRoot);
  if (!resolved) return null;
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "GET, HEAD" },
  });
}

async function resolveSiteStaticFile(
  request: Request,
  siteRoot: string,
): Promise<{ readonly realPath: string } | null> {
  const url = new URL(request.url);
  const relativePublicPath = publicRelativePath(url.pathname);
  if (relativePublicPath === null) return null;

  const publicRoot = resolve(siteRoot, "public");
  let realPublicRoot: string;
  try {
    realPublicRoot = await realpath(publicRoot);
    const rootDetails = await stat(realPublicRoot);
    if (!rootDetails.isDirectory()) return null;
  } catch {
    return null;
  }

  const candidatePath = resolve(
    publicRoot,
    ...relativePublicPath.split("/").filter(Boolean),
  );
  if (!isWithin(publicRoot, candidatePath)) return null;

  try {
    const realTarget = await realpath(candidatePath);
    if (!isWithin(realPublicRoot, realTarget)) return null;
    const details = await stat(realTarget);
    if (!details.isFile()) return null;
    return { realPath: realTarget };
  } catch {
    return null;
  }
}

function publicRelativePath(pathname: string): string | null {
  if (pathname.includes("\0")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\\")) return null;
  if (isCoreReservedPath(decoded)) return null;

  const segments = decoded.split("/").filter((segment, index) => {
    if (index === 0) return false;
    return segment.length > 0;
  });

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (!segment.startsWith(".")) continue;
    if (index === 0 && segment === ".well-known") continue;
    return null;
  }

  return segments.join("/");
}

function isCoreReservedPath(pathname: string): boolean {
  return (
    pathname === "/assets" ||
    pathname.startsWith("/assets/") ||
    pathname === "/_admin" ||
    pathname.startsWith("/_admin/") ||
    pathname === "/_action" ||
    pathname.startsWith("/_action/") ||
    pathname === "/_system" ||
    pathname.startsWith("/_system/")
  );
}

function mediaTypeFor(filename: string): string {
  const type = Bun.file(filename).type;
  if (!type || type === "") return "application/octet-stream";
  return type;
}

function weakEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

function etagMatches(header: string, etag: string): boolean {
  return header
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "*" || part === etag);
}

function notModifiedSince(header: string, mtimeMs: number): boolean {
  const since = Date.parse(header);
  if (Number.isNaN(since)) return false;
  return Math.trunc(mtimeMs / 1000) <= Math.trunc(since / 1000);
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
