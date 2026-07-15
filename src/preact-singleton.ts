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
   * Theme pages/islands and plugin admin components resolve `preact` from the
   * site root; diitey SSR resolves it from the package install. Two physical
   * copies break hooks (`r.__H`).
   *
   * Bun.plugin onResolve does not rewrite runtime imports of absolute site
   * paths, so TSX/TS is loaded through onLoad: classic-JSX transpile + rewrite
   * every `preact*` import onto the same modules diitey uses.
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

    const siteSource =
      /[/\\](?:themes|plugins)[/\\].+\.(tsx|jsx|ts)$/;

    Bun.plugin({
      name: "diitey-preact-singleton",
      setup(build) {
        build.onLoad({ filter: siteSource }, async (args) => {
          if (args.path.includes(`${"node_modules"}`)) {
            const loader = args.path.endsWith(".ts")
              ? "ts"
              : args.path.endsWith(".tsx")
                ? "tsx"
                : "jsx";
            return {
              contents: await Bun.file(args.path).text(),
              loader,
            };
          }

          const source = await Bun.file(args.path).text();
          if (args.path.endsWith(".ts") && !args.path.endsWith(".tsx")) {
            return {
              contents: rewritePreactSpecifiers(source, resolved),
              loader: "ts",
            };
          }

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
        });
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
