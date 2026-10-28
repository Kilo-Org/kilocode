// Builds the extension host (Node, CommonJS) and the webview (browser, Solid, with the kilo-ui styles, fonts and
// Shiki workers) into dist/. The webview config follows main's esbuild.js for the v1 UI packages.
import { transformAsync } from "@babel/core"
import { build, type Plugin } from "esbuild"
import { copyFile, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
const production = Bun.argv.includes("--production")
// `--meta` writes the bundled source files to dist/inputs.txt (used to keep only reachable copied v1 UI files).
const meta = Bun.argv.includes("--meta")
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const solid: Plugin = {
  name: "solid",
  setup(build) {
    build.onLoad({ filter: /\.(t|j)sx$/ }, async (args) => {
      const result = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [["babel-preset-solid", { generate: "dom" }], "@babel/preset-typescript"],
      })
      return { contents: result?.code ?? "", loader: "js" }
    })
  },
}

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

// One hidden element per sprite (file icons, provider icons), so a second sprite is not skipped.
const sprite: Plugin = {
  name: "svg-sprite-inline",
  setup(build) {
    build.onLoad({ filter: /sprite\.svg$/ }, async (args) => ({
      contents: `
        const svg = ${JSON.stringify(await Bun.file(args.path).text())};
        const inject = () => {
          if (document.getElementById(${JSON.stringify(`kilo-sprite-${path.basename(path.dirname(args.path))}`)})) return;
          const el = document.createElement("div");
          el.id = ${JSON.stringify(`kilo-sprite-${path.basename(path.dirname(args.path))}`)};
          el.style.display = "none";
          el.innerHTML = svg;
          document.body.appendChild(el);
        };
        if (document.body) inject();
        else document.addEventListener("DOMContentLoaded", inject);
        export default "";
      `,
      loader: "js",
    }))
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

const shiki: Plugin = {
  name: "shiki-worker-entry",
  setup(build) {
    build.onResolve({ filter: /^kilo-shiki-worker$/ }, async () => {
      const resolved = await build.resolve("@pierre/diffs/worker/worker.js", {
        kind: "import-statement",
        resolveDir: root,
      })
      if (resolved.errors.length > 0) return { errors: resolved.errors }
      return { path: resolved.path }
    })
  },
}

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "warning" as const,
  metafile: meta,
}

const host = Bun.build({
  entrypoints: [path.join(root, "src/extension.ts")],
  outdir: dist,
  target: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: "linked",
})

const results = await Promise.all([
  host.then((result) => {
    if (result.success) return
    result.logs.forEach((log) => console.error(log))
    throw new Error("extension host build failed")
  }),
  build({
    ...common,
    entryPoints: { webview: path.join(root, "webview-ui/src/index.tsx") },
    outdir: dist,
    format: "iife",
    platform: "browser",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    plugins: [dedupe, pierre, markdown, sprite, css, solid],
  }),
  build({
    ...common,
    entryPoints: ["kilo-shiki-worker"],
    outfile: path.join(dist, "shiki-worker.js"),
    format: "iife",
    platform: "browser",
    plugins: [shiki],
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "..", "kilo-ui-base", "src", "components", "markdown-shiki.worker.ts")],
    outfile: path.join(dist, "markdown-shiki-worker.js"),
    format: "esm",
    platform: "browser",
  }),
  // The animated Kilo logo loads its WASM renderer from next to the bundle; the CSP blocks the CDN default.
  copyFile(
    path.join(path.dirname(Bun.resolveSync("@lottiefiles/dotlottie-web/package.json", root)), "dist", "dotlottie-player.wasm"),
    path.join(dist, "dotlottie-player.wasm"),
  ),
])
if (meta)
  await Bun.write(
    path.join(dist, "inputs.txt"),
    [...new Set(results.flatMap((result) => Object.keys((result && "metafile" in result && result.metafile?.inputs) || {})))]
      .map((file) => path.resolve(root, file))
      .join("\n"),
  )
console.log("built dist/")
