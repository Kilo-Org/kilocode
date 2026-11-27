// Builds the extension host (Node, CommonJS) and the webviews (browser, Solid ES modules with shared and lazy
// chunks, kilo-ui styles, fonts and Shiki workers) into dist/. Dev builds reuse unchanged targets and diff-write
// webview chunks so manual test cycles only rebuild what actually changed.
import type { BunPlugin } from "bun"
import { build, type Plugin } from "esbuild"
import { existsSync } from "node:fs"
import { copyFile, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { currentFfmpegTarget, ensureFfmpegForTarget, hasFfmpegPackage } from "./ffmpeg-helper"
import {
  collectRelativeFiles,
  hasStateDir,
  isTargetFresh,
  listDirFiles,
  markStateDirReady,
  readTargetState,
  snapshotDirectories,
  stampFiles,
  stampOutputs,
  syncOutputFiles,
  writeTargetState,
  type TargetState,
} from "./incremental"
import { createSolidPlugin } from "./solid-cache"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
const stateDir = path.join(root, "node_modules", ".cache", "kilo-vscode-build-state")

const primaryWebviewEntries = {
  webview: path.join(root, "webview-ui/src/index.tsx"),
}

const agentManagerEntry = {
  "agent-manager": path.join(root, "webview-ui/agent-manager/index.tsx"),
}

const panelEntries = {
  "browser-tab": path.join(root, "webview-ui/browser-tab/index.tsx"),
  documents: path.join(root, "webview-ui/documents/index.tsx"),
  "diff-viewer": path.join(root, "webview-ui/diff-viewer/index.tsx"),
  "diff-virtual": path.join(root, "webview-ui/diff-virtual/index.tsx"),
  settings: path.join(root, "webview-ui/settings/index.tsx"),
}

// Directories scanned at build time by `src/services/i18n/worktree-caller.macro.ts`, which do not appear in
// Bun.build's static metafile inputs.
const macroLocaleDirs = [
  path.join(root, "webview-ui/agent-manager/i18n"),
  path.join(root, "webview-ui/src/i18n"),
  path.resolve(root, "../kilo-i18n/src"),
]

const buildScripts = [
  path.join(import.meta.dir, "build.ts"),
  path.join(import.meta.dir, "incremental.ts"),
  path.join(import.meta.dir, "solid-cache.ts"),
  path.join(root, "package.json"),
]

export type BuildOptions = {
  production?: boolean
  meta?: boolean
  clean?: boolean
}

export async function buildExtension(options: BuildOptions = {}) {
  const production = options.production ?? false
  const meta = options.meta ?? false
  const fullClean = production || meta || (options.clean ?? false)
  const incremental = !fullClean && hasStateDir(stateDir)

  if (!incremental) {
    await rm(stateDir, { recursive: true, force: true })
    await rm(dist, { recursive: true, force: true })
  }
  await mkdir(dist, { recursive: true })

  // A production package ships the build host's FFmpeg fallback, which Linux, Windows and a failed native macOS
  // capture need. Build each target's package on that target. `KILO_VSCODE_TARGET` selects the helper for a
  // cross-target package.
  if (production) await bundleFfmpeg()

  const rebuilt: string[] = []
  const metaInputs: string[] = []
  const updated: Array<[string, TargetState]> = []

  const runTarget = async (
    name: string,
    task: (previous: TargetState | undefined) => Promise<{ state: TargetState; inputs?: string[] }>,
  ) => {
    const previous = incremental ? readTargetState(stateDir, name) : undefined
    if (incremental && isTargetFresh(previous, dist)) return
    rebuilt.push(name)
    const result = await task(previous)
    updated.push([name, result.state])
    if (result.inputs) metaInputs.push(...result.inputs)
  }

  await Promise.all([
    runTarget("host", () => buildHost(production)),
    runTarget("tokenizers", () => buildTokenizers(production)),
    runTarget("playwright", () => copyPlaywright()),
    runTarget("webviews", (previous) => buildWebviews(production, previous)),
    runTarget("shikiWorker", () => buildShikiWorker(production)),
    runTarget("markdownWorker", () => buildMarkdownWorker(production)),
    runTarget("wasms", () => copyWasms()),
  ])

  if (meta) {
    await Bun.write(path.join(dist, "inputs.txt"), [...new Set(metaInputs)].join("\n"))
  }
  if (!production && !meta) {
    for (const [name, state] of updated) writeTargetState(stateDir, name, state)
    markStateDirReady(stateDir)
  }
  const detail = rebuilt.length === 0 ? " (up to date)" : incremental ? ` (rebuilt: ${rebuilt.join(", ")})` : ""
  console.log(`built dist/${detail}`)
}

async function bundleFfmpeg() {
  const target = process.env.KILO_VSCODE_TARGET ?? currentFfmpegTarget()
  const bin = path.join(root, "bin")
  await mkdir(bin, { recursive: true })
  await ensureFfmpegForTarget(target, bin)
  const helper = path.join(bin, target.startsWith("win32") ? "ffmpeg.exe" : "ffmpeg")
  if (existsSync(helper)) return
  // win32-arm64 has no helper package. v1 shipped it without one, and capture falls back to a system FFmpeg.
  if (hasFfmpegPackage(target)) throw new Error(`FFmpeg helper was not bundled at ${helper}`)
  console.warn(`No bundled FFmpeg for ${target}; voice input needs a system FFmpeg on that host.`)
}

async function buildHost(production: boolean) {
  // `playwright-core` stays external: the host bundle requires it at runtime from `dist/node_modules`, because it
  // carries the Chromium launcher and its protocol generated code, which compile slowly and would be minified away.
  // Autocomplete tokenizers stay in a sibling lazy chunk (`./autocomplete-tokenizers.js`) loaded on first completion
  // so extension activation never parses 6+ MB of BPE vocabulary tables.
  const externalTokenizers: BunPlugin = {
    name: "external-autocomplete-tokenizers",
    setup(build) {
      build.onResolve({ filter: /^\.\/tokenizers(\.js)?$/ }, (args) => {
        if (!args.importer.replaceAll("\\", "/").endsWith("core/llm/countTokens.ts")) return undefined
        return { path: "./autocomplete-tokenizers.js", external: true }
      })
    },
  }
  const result = await Bun.build({
    entrypoints: [path.join(root, "src/extension.ts")],
    outdir: dist,
    target: "node",
    format: "cjs",
    minify: production,
    external: ["vscode", "playwright-core"],
    plugins: [externalTokenizers],
    sourcemap: production ? "none" : "linked",
    metafile: true,
  })
  if (!result.success) {
    result.logs.forEach((log) => console.error(log))
    throw new Error("extension host build failed")
  }
  // A CommonJS host cannot parse `import.meta`; it reaches the bundle when a dynamic import wraps an ESM graph.
  if ((await Bun.file(path.join(dist, "extension.js")).text()).includes("import.meta"))
    throw new Error("extension host bundle contains import.meta and would fail to activate")

  const inputs = [
    ...resolveMetaInputs(result.metafile?.inputs, process.cwd()),
    ...listDirFiles(macroLocaleDirs),
    path.join(root, "tsconfig.json"),
    ...buildScripts,
  ]
  const outputs = result.outputs.map((item) => path.relative(dist, item.path).split(path.sep).join("/"))
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles(inputs),
      directories: snapshotDirectories(macroLocaleDirs),
      outputs: stampOutputs(dist, outputs),
    },
    inputs,
  }
}

async function buildTokenizers(production: boolean) {
  const entry = path.join(root, "src/services/autocomplete/continuedev/core/llm/tokenizers.ts")
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: dist,
    naming: "autocomplete-tokenizers.js",
    target: "node",
    format: "cjs",
    minify: production,
    sourcemap: production ? "none" : "linked",
    metafile: true,
  })
  if (!result.success) {
    result.logs.forEach((log) => console.error(log))
    throw new Error("autocomplete tokenizers build failed")
  }
  const inputs = [...resolveMetaInputs(result.metafile?.inputs, process.cwd()), ...buildScripts]
  const outputs = result.outputs.map((item) => path.relative(dist, item.path).split(path.sep).join("/"))
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles(inputs),
      outputs: stampOutputs(dist, outputs),
    },
    inputs,
  }
}

async function copyPlaywright() {
  const source = path.dirname(Bun.resolveSync("playwright-core/package.json", root))
  const destination = path.join(dist, "node_modules", "playwright-core")
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (file) => path.basename(file) !== "node_modules",
  })
  const sourceFiles = collectRelativeFiles(source)
    .filter((rel) => !rel.startsWith("node_modules/") && !rel.includes("/node_modules/"))
    .map((rel) => path.join(source, rel))
  const outputFiles = collectRelativeFiles(destination).map((rel) => `node_modules/playwright-core/${rel}`)
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles([...sourceFiles, ...buildScripts]),
      outputs: stampOutputs(dist, outputFiles),
    },
  }
}

async function buildWebviews(production: boolean, previous: TargetState | undefined) {
  const solid = createSolidPlugin({ root })
  const plugins = webviewPlugins(solid)
  // Build the sidebar (`webview`) and Agent Manager (`agent-manager`) independently from secondary panels.
  // Each VS Code webview runs in its own isolated origin (no shared HTTP cache), so cross-entry splitting
  // produced 95-115 tiny static chunks per webview that had to traverse VS Code's ServiceWorker waterfall.
  // Isolating primary entries keeps initial boot to 1 JS + 1 CSS request while preserving lazy chunks.
  const groups = [
    { entryPoints: primaryWebviewEntries, chunkNames: "chunks-webview/[name]-[hash]" },
    { entryPoints: agentManagerEntry, chunkNames: "chunks-am/[name]-[hash]" },
    { entryPoints: panelEntries, chunkNames: "chunks-panels/[name]-[hash]" },
  ] as const

  const results = await Promise.all(
    groups.map((group) =>
      build({
        absWorkingDir: root,
        bundle: true,
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: "warning",
        metafile: true,
        write: production,
        entryPoints: group.entryPoints,
        outdir: dist,
        chunkNames: group.chunkNames,
        assetNames: "assets/[name]-[hash]",
        format: "esm",
        splitting: true,
        platform: "browser",
        loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
        plugins,
      }),
    ),
  )

  const inputs = [
    ...new Set([
      ...results.flatMap((result) => resolveMetaInputs(result.metafile?.inputs, root)),
      path.join(root, "webview-ui/tsconfig.json"),
      ...buildScripts,
    ]),
  ]
  const outputMap = new Map<string, NonNullable<(typeof results)[number]["outputFiles"]>[number]>()
  for (const result of results) {
    for (const file of result.outputFiles ?? []) outputMap.set(file.path, file)
  }
  const outputRelPaths = [
    ...new Set(
      results.flatMap((result) =>
        Object.keys(result.metafile?.outputs ?? {}).map((file) =>
          path.relative(dist, path.resolve(root, file)).split(path.sep).join("/"),
        ),
      ),
    ),
  ]
  const outputs = production
    ? stampOutputs(dist, outputRelPaths)
    : await syncOutputFiles(dist, previous?.outputs, [...outputMap.values()])
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles(inputs),
      outputs,
    },
    inputs,
  }
}

async function buildShikiWorker(production: boolean) {
  const entry = Bun.resolveSync("@pierre/diffs/worker/worker.js", root)
  return buildWorker("shiki-worker.js", entry, "iife", production)
}

async function buildMarkdownWorker(production: boolean) {
  const entry = path.join(root, "..", "kilo-ui-base", "src", "components", "markdown-shiki.worker.ts")
  return buildWorker("markdown-shiki-worker.js", entry, "esm", production)
}

async function buildWorker(naming: string, entry: string, format: "iife" | "esm", production: boolean) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: dist,
    naming,
    target: "browser",
    format,
    minify: production,
    sourcemap: production ? "none" : "linked",
    metafile: true,
  })
  if (!result.success) {
    result.logs.forEach((log) => console.error(log))
    throw new Error(`${naming} build failed`)
  }
  const inputs = [...resolveMetaInputs(result.metafile?.inputs, process.cwd()), ...buildScripts]
  const outputs = result.outputs.map((item) => path.relative(dist, item.path).split(path.sep).join("/"))
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles(inputs),
      outputs: stampOutputs(dist, outputs),
    },
    inputs,
  }
}

async function copyWasms() {
  // The animated Kilo logo, libghostty terminal, and lazy SVG icon sprites load next to the bundle;
  // the CSP blocks external URLs.
  const uiBase = path.resolve(root, "..", "kilo-ui-base", "src", "components")
  const sources = [
    ["dotlottie-player.wasm", path.join(path.dirname(Bun.resolveSync("@lottiefiles/dotlottie-web/package.json", root)), "dist", "dotlottie-player.wasm")],
    ["ghostty-vt.wasm", path.join(path.dirname(Bun.resolveSync("ghostty-web/package.json", root)), "ghostty-vt.wasm")],
    ["file-icons-sprite.svg", path.join(uiBase, "file-icons", "sprite.svg")],
    ["provider-icons-sprite.svg", path.join(uiBase, "provider-icons", "sprite.svg")],
  ] as const
  await Promise.all(sources.map(([name, source]) => copyFile(source, path.join(dist, name))))
  return {
    state: {
      version: 1 as const,
      inputs: stampFiles([...sources.map(([, source]) => source), ...buildScripts]),
      outputs: stampOutputs(
        dist,
        sources.map(([name]) => name),
      ),
    },
  }
}

function resolveMetaInputs(inputs: Record<string, unknown> | undefined, baseDir: string) {
  return Object.keys(inputs ?? {})
    .filter((file) => !file.includes(":"))
    .map((file) => (path.isAbsolute(file) ? file : path.resolve(baseDir, file)))
}

function webviewPlugins(solid: Plugin): Plugin[] {
  // One solid-js copy for kilo-ui, the v1 UI base and the webview, so their contexts see each other.
  const dedupe: Plugin = {
    name: "solid-dedupe",
    setup(build) {
      const base = path.dirname(Bun.resolveSync("solid-js/package.json", root))
      const aliases: Record<string, string> = {
        "solid-js": path.join(base, "dist", "solid.js"),
        "solid-js/web": path.join(base, "web", "dist", "web.js"),
        "solid-js/store": path.join(base, "store", "dist", "store.js"),
      }
      build.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
    },
  }

  // The v1 UI base loads Pierre's Shiki worker through a Vite-only import; use the Kilo loader instead.
  const pierre: Plugin = {
    name: "pierre-worker-alias",
    setup(build) {
      build.onResolve({ filter: /pierre\/worker$/ }, (args) => {
        if (args.path.includes("@pierre")) return undefined
        return { path: path.join(root, "webview-ui", "pierre-worker.ts") }
      })
    },
  }

  const markdown: Plugin = {
    name: "markdown-worker-url",
    setup(build) {
      build.onResolve({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({
        path: "markdown-shiki-worker-url",
        namespace: "kilo-worker-url",
      }))
      build.onLoad({ filter: /.*/, namespace: "kilo-worker-url" }, () => ({
        contents: "export default window.KILO_MARKDOWN_SHIKI_WORKER_URI",
        loader: "js",
      }))
    },
  }

  // Serve large SVG icon sprites (`file-icons`, `provider-icons`) as static files in `dist/` and lazily
  // fetch + inject only the `<symbol>` elements actually rendered by mounted icons. This keeps 1.28 MB of
  // SVG out of the JS bundles and eliminates ~4,000+ hidden DOM nodes from initial startup.
  const sprite: Plugin = {
    name: "svg-sprite-lazy",
    setup(build) {
      const registry = path.resolve(root, "..", "kilo-ui-base", "src", "components", "sprite-registry.ts")
      build.onLoad({ filter: /sprite\.svg$/ }, async (args) => {
        const kind = path.basename(path.dirname(args.path))
        const asset = `${kind}-sprite.svg`
        return {
          contents: `
            import { registerSpriteLoader } from ${JSON.stringify(registry)};
            const kind = ${JSON.stringify(kind)};
            const asset = ${JSON.stringify(asset)};
            const inserted = new Set();
            const wanted = new Set();
            let index = null;
            let loading = null;
            let defs = null;
            const ensureContainer = () => {
              if (defs && defs.isConnected) return defs;
              const id = "kilo-sprite-" + kind;
              let svg = document.getElementById(id);
              if (!svg) {
                svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.id = id;
                svg.setAttribute("width", "0");
                svg.setAttribute("height", "0");
                svg.style.display = "none";
                defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                svg.appendChild(defs);
                (document.body || document.documentElement).appendChild(svg);
              } else {
                defs = svg.querySelector("defs") || svg;
              }
              return defs;
            };
            const flush = () => {
              if (!index || wanted.size === 0) return;
              const target = ensureContainer();
              let markup = "";
              for (const name of wanted) {
                if (inserted.has(name)) continue;
                const raw = index.get(name);
                if (raw) {
                  inserted.add(name);
                  markup += raw;
                }
              }
              wanted.clear();
              if (markup) target.insertAdjacentHTML("beforeend", markup);
            };
            const load = () => {
              if (loading) return loading;
              const base = typeof window !== "undefined" && typeof window.KILO_SHIKI_WORKER_URI === "string"
                ? window.KILO_SHIKI_WORKER_URI.replace(/shiki-worker\\.js$/, "")
                : "";
              const url = base ? base + asset : new URL("./" + asset, import.meta.url).href;
              loading = fetch(url)
                .then((res) => (res.ok ? res.text() : ""))
                .then((text) => {
                  const map = new Map();
                  const re = /<symbol\\b[^>]*\\bid="([^"]+)"[^>]*>[\\s\\S]*?<\\/symbol>/g;
                  let m;
                  while ((m = re.exec(text)) !== null) map.set(m[1], m[0]);
                  index = map;
                  flush();
                })
                .catch(() => {
                  loading = null;
                });
              return loading;
            };
            registerSpriteLoader(kind, (name) => {
              if (!name || inserted.has(name)) return;
              wanted.add(name);
              if (index) flush();
              else void load();
            });
            export default "";
          `,
          loader: "js",
        }
      })
    },
  }

  const css: Plugin = {
    name: "css-package-resolve",
    setup(build) {
      build.onResolve({ filter: /^@/, namespace: "file" }, (args) => {
        if (args.kind !== "import-rule") return undefined
        return build.resolve(args.path, { kind: "import-statement", resolveDir: args.resolveDir })
      })
    },
  }

  // ghostty-web's Vite dist embeds a 1.3 MB base64 copy of ghostty-vt.wasm for zero-config bundlers.
  // VS Code webviews block `fetch("data:...")` via CSP anyway and load dist/ghostty-vt.wasm via KILO_GHOSTTY_WASM_URI,
  // so strip the unused inline payload from the agent-manager bundle.
  const ghostty: Plugin = {
    name: "ghostty-strip-inline-wasm",
    setup(build) {
      build.onLoad({ filter: /ghostty-web[/\\]dist[/\\]ghostty-web\.js$/ }, async (args) => {
        const source = await Bun.file(args.path).text()
        return {
          contents: source.replace(/"data:application\/wasm;base64,[A-Za-z0-9+/=]+"/, '""'),
          loader: "js",
        }
      })
    },
  }

  return [dedupe, pierre, markdown, sprite, css, ghostty, solid]
}

if (import.meta.main) {
  await buildExtension({
    production: Bun.argv.includes("--production"),
    // `--meta` writes the bundled source files to dist/inputs.txt (used to keep only reachable copied v1 UI files).
    meta: Bun.argv.includes("--meta"),
    clean: Bun.argv.includes("--clean"),
  })
}
