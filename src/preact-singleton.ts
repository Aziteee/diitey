const preactSubpaths = [
  "preact",
  "preact/hooks",
  "preact/jsx-runtime",
  "preact/jsx-dev-runtime",
  "preact/compat",
  "preact/debug",
  "preact/devtools",
  "preact/test-utils",
] as const;

let installed = false;

/**
 * Theme pages/islands resolve `preact` from the site root; diitey SSR resolves
 * it from the package install. Two physical copies break hooks (`r.__H`).
 *
 * Bun.plugin onResolve does not rewrite runtime imports of absolute theme paths,
 * so theme TSX/TS is loaded through onLoad: classic-JSX transpile + rewrite every
 * `preact*` import onto the same modules diitey uses.
 */
export function installPreactSingleton(): void {
  if (installed) return;
  installed = true;

  const from = import.meta.dir;
  const resolved = new Map<string, string>();
  for (const id of preactSubpaths) {
    try {
      resolved.set(id, Bun.resolveSync(id, from));
    } catch {
      // optional subpath
    }
  }
  const preactMain = resolved.get("preact");
  if (!preactMain) {
    throw new Error("diitey requires the preact package");
  }

  Bun.plugin({
    name: "diitey-preact-singleton",
    setup(build) {
      // Only theme sources — keep the filter narrow so we always return contents.
      build.onLoad(
        { filter: /[/\\]themes[/\\].+\.(tsx|jsx)$/ },
        async (args) => {
          if (args.path.includes(`${"node_modules"}`)) {
            return { contents: await Bun.file(args.path).text(), loader: "tsx" };
          }
          const source = await Bun.file(args.path).text();
          const loader = args.path.endsWith("tsx") ? "tsx" : "jsx";
          const transpiler = new Bun.Transpiler({
            loader,
            tsconfig: {
              compilerOptions: {
                jsx: "react",
                jsxFactory: "h",
                jsxFragmentFactory: "Fragment",
              },
            },
          });
          let code = transpiler.transformSync(source);
          code = rewritePreactSpecifiers(code, resolved);
          if (needsFactoryImport(code)) {
            code =
              `import { h, Fragment } from ${JSON.stringify(preactMain)};\n` +
              code;
          }
          return { contents: code, loader: "js" };
        },
      );

      build.onLoad(
        { filter: /[/\\]themes[/\\].+\.ts$/ },
        async (args) => {
          if (args.path.includes(`${"node_modules"}`)) {
            return { contents: await Bun.file(args.path).text(), loader: "ts" };
          }
          const source = await Bun.file(args.path).text();
          const code = rewritePreactSpecifiers(source, resolved);
          return { contents: code, loader: "ts" };
        },
      );
    },
  });
}

function rewritePreactSpecifiers(
  code: string,
  resolved: Map<string, string>,
): string {
  let next = code;
  const ids = [...resolved.keys()].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const abs = JSON.stringify(resolved.get(id));
    next = next.replaceAll(`from "${id}"`, `from ${abs}`);
    next = next.replaceAll(`from '${id}'`, `from ${abs}`);
    next = next.replaceAll(`import("${id}")`, `import(${abs})`);
    next = next.replaceAll(`import('${id}')`, `import(${abs})`);
  }
  return next;
}

function needsFactoryImport(code: string): boolean {
  if (!/\bh\s*\(/.test(code) && !/\bFragment\b/.test(code)) return false;
  return !/\bimport\s*\{[^}]*\bh\b/.test(code);
}

installPreactSingleton();
