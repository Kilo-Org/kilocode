import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type BuildOptions, type Plugin } from "esbuild"

const __dirname = path.resolve(import.meta.dir, "..")
const rootDir = path.resolve(__dirname, "../..")
const ideUiSrc = path.join(rootDir, "packages/kilo-ide-ui/src")

// Require build tools from local node_modules
const core = require(path.join(__dirname, "node_modules/@babel/core"))
const solid = require(path.join(__dirname, "node_modules/babel-preset-solid"))
const ts = require(path.join(__dirname, "node_modules/@babel/preset-typescript"))

const production = process.argv.includes("--production")
const solidCacheDir = path.join(__dirname, "node_modules/.cache/esbuild-solid")
const solidMemCache = new Map<string, string>()

const buildScriptHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(fileURLToPath(import.meta.url), "utf8"))
  .update(require(path.join(__dirname, "node_modules/babel-preset-solid/package.json")).version || "")
  .update(require(path.join(__dirname, "node_modules/@babel/preset-typescript/package.json")).version || "")
  .digest("hex")
  .slice(0, 8)

if (!fs.existsSync(solidCacheDir)) {
  try {
    fs.mkdirSync(solidCacheDir, { recursive: true })
  } catch (err) {
    console.warn("[esbuild] could not create solid cache directory", err)
  }
}

const cachedSolidPlugin: Plugin = {
  name: "esbuild:solid-cached",
  setup(build) {
    build.onLoad({ filter: /\.(t|j)sx$/ }, async (args) => {
      let mtime = 0
      let size = 0
      try {
        const st = fs.statSync(args.path)
        mtime = st.mtimeMs
        size = st.size
      } catch (err) {
        console.warn("[esbuild] could not stat source file for cache key", args.path, err)
      }

      const cacheKey = `${args.path}:${mtime}:${size}:${buildScriptHash}`
      const memHit = solidMemCache.get(cacheKey)
      if (memHit) return { contents: memHit, loader: "js" }

      const diskKey = crypto.createHash("sha256").update(cacheKey).digest("hex") + ".js"
      const diskPath = path.join(solidCacheDir, diskKey)

      if (fs.existsSync(diskPath)) {
        try {
          const diskCode = fs.readFileSync(diskPath, "utf8")
          solidMemCache.set(cacheKey, diskCode)
          return { contents: diskCode, loader: "js" }
        } catch (err) {
          console.warn("[esbuild] cache read failed, rebuilding", diskPath, err)
        }
      }

      const source = fs.readFileSync(args.path, "utf8")
      const { name, ext } = path.parse(args.path)
      const filename = name + ext
      const result = await core.transformAsync(source, {
        presets: [
          [solid, {}],
          [ts, {}],
        ],
        filename,
        sourceMaps: "inline",
      })

      if (result?.code === undefined || result.code === null) {
        throw new Error("No result was provided from Babel")
      }

      if (solidMemCache.size > 2000) solidMemCache.clear()
      solidMemCache.set(cacheKey, result.code)
      try {
        fs.writeFileSync(diskPath, result.code)
      } catch (err) {
        console.warn("[esbuild] cache write failed", diskPath, err)
      }

      return { contents: result.code, loader: "js" }
    })
  },
}

const solidDedupePlugin: Plugin = {
  name: "solid-dedupe",
  setup(build) {
    const solidRoot = path.dirname(require.resolve(path.join(__dirname, "node_modules/solid-js/package.json")))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solidRoot, "dist", "solid.js"),
      "solid-js/web": path.join(solidRoot, "web", "dist", "web.js"),
      "solid-js/store": path.join(solidRoot, "store", "dist", "store.js"),
    }

    build.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => {
      const key = args.path
      if (aliases[key]) {
        return { path: aliases[key] }
      }
    })
  },
}

const pierreWorkerAliasPlugin: Plugin = {
  name: "pierre-worker-alias",
  setup(build) {
    build.onResolve({ filter: /pierre\/worker$/ }, (args) => {
      if (args.path.includes("@pierre")) return
      return { path: path.join(__dirname, "webview-ui", "pierre-worker.ts") }
    })
  },
}

const markdownWorkerUrlPlugin: Plugin = {
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

const shikiWorkerEntryPlugin: Plugin = {
  name: "shiki-worker-entry",
  setup(build) {
    build.onResolve({ filter: /^kilo-shiki-worker$/ }, async () => {
      const resolved = await build.resolve("@pierre/diffs/worker/worker.js", {
        kind: "import-statement",
        resolveDir: __dirname,
      })
      if (resolved.errors.length > 0) return { errors: resolved.errors }
      return { path: resolved.path }
    })
  },
}

const svgSpritePlugin: Plugin = {
  name: "svg-sprite-inline",
  setup(build) {
    build.onLoad({ filter: /sprite\.svg$/ }, (args) => {
      const content = fs.readFileSync(args.path, "utf8")
      return {
        contents: `
          const svg = ${JSON.stringify(content)};
          const inject = () => {
            if (!document.getElementById("kilo-sprite")) {
              const el = document.createElement("div");
              el.id = "kilo-sprite";
              el.style.display = "none";
              el.innerHTML = svg;
              document.body.appendChild(el);
            }
          };
          if (document.body) inject();
          else document.addEventListener("DOMContentLoaded", inject);
          export default "";
        `,
        loader: "js",
      }
    })
  },
}

const cssPackageResolvePlugin: Plugin = {
  name: "css-package-resolve",
  setup(build) {
    build.onResolve({ filter: /^@/, namespace: "file" }, (args) => {
      if (args.kind === "import-rule") {
        if (args.path === "@kilocode/ide-ui/styles") {
          return { path: path.join(ideUiSrc, "styles/index.css") }
        }
        if (args.path === "@kilocode/ide-ui/styles/tailwind") {
          return { path: path.join(ideUiSrc, "styles/tailwind/index.css") }
        }
        if (args.path === "@kilocode/kilo-ui/styles") {
          return { path: path.join(rootDir, "packages/kilo-ui/src/styles/index.css") }
        }
        return build.resolve(args.path, {
          kind: "import-statement",
          resolveDir: args.resolveDir,
        })
      }
    })
  },
}

const indexingResolvePlugin: Plugin = {
  name: "indexing-resolve",
  setup(build) {
    build.onResolve({ filter: /^@kilocode\/kilo-indexing\/(.*)$/ }, (args) => {
      const sub = args.path.replace("@kilocode/kilo-indexing/", "")
      const indexingDir = path.join(rootDir, "packages/kilo-indexing/src")
      if (sub === "config") return { path: path.join(indexingDir, "config.ts") }
      if (sub === "embedding-models") return { path: path.join(indexingDir, "kilo-embedding-models.ts") }
      if (sub === "detect") return { path: path.join(__dirname, "src/shared/indexing-plugin-spec.ts") }
    })
  },
}

// Resolver plugin to route @kilocode/ide-ui component imports directly to packages/kilo-ide-ui
const ideUiResolvePlugin: Plugin = {
  name: "ide-ui-resolve",
  setup(build) {
    build.onResolve({ filter: /^@kilocode\/ide-ui/ }, (args) => {
      const sub = args.path.replace("@kilocode/ide-ui", "")
      const candidates = [
        path.join(ideUiSrc, sub + ".tsx"),
        path.join(ideUiSrc, sub + ".ts"),
        path.join(ideUiSrc, "components", sub + ".tsx"),
        path.join(ideUiSrc, "components", sub + ".ts"),
        path.join(ideUiSrc, sub, "index.tsx"),
        path.join(ideUiSrc, sub, "index.ts"),
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return { path: candidate }
        }
      }
    })
  },
}

function getWebviewsConfig(): BuildOptions {
  return {
    entryPoints: {
      "agent-manager": path.join(__dirname, "webview-ui/agent-manager/index.tsx"),
      kiloclaw: path.join(__dirname, "webview-ui/kiloclaw/index.tsx"),
      marketplace: path.join(__dirname, "webview-ui/marketplace/index.tsx"),
      "diff-viewer": path.join(__dirname, "webview-ui/diff-viewer/index.tsx"),
      "diff-virtual": path.join(__dirname, "webview-ui/diff-virtual/index.tsx"),
      webview: path.join(__dirname, "webview-ui/src/index.tsx"),
    },
    outdir: path.join(__dirname, "dist"),
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    logLevel: "warning",
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
    },
    plugins: [
      solidDedupePlugin,
      pierreWorkerAliasPlugin,
      markdownWorkerUrlPlugin,
      svgSpritePlugin,
      cssPackageResolvePlugin,
      indexingResolvePlugin,
      ideUiResolvePlugin,
      cachedSolidPlugin,
    ],
  }
}

function getShikiWorkerConfig(): BuildOptions {
  return {
    entryPoints: ["kilo-shiki-worker"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: path.join(__dirname, "dist/shiki-worker.js"),
    logLevel: "warning",
    plugins: [shikiWorkerEntryPlugin],
  }
}

function getMarkdownShikiWorkerConfig(): BuildOptions {
  const workerSrc = path.join(ideUiSrc, "components/markdown-shiki.worker.ts")

  return {
    entryPoints: [workerSrc],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: path.join(__dirname, "dist/markdown-shiki-worker.js"),
    logLevel: "warning",
  }
}

async function main() {
  console.log("[build-existing-web] Building all 6 webview entries and workers from transplanted source...")
  const distDir = path.join(__dirname, "dist")
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  const webviewsConfig = getWebviewsConfig()
  const shikiWorkerConfig = getShikiWorkerConfig()
  const markdownShikiWorkerConfig = getMarkdownShikiWorkerConfig()

  const results = await Promise.all(
    [webviewsConfig, shikiWorkerConfig, markdownShikiWorkerConfig].map((config) =>
      build({ ...config, absWorkingDir: __dirname, metafile: true }),
    ),
  )
  for (const result of results) {
    for (const source of Object.keys(result.metafile.inputs)) {
      const candidate = path.resolve(__dirname, source)
      if (!fs.existsSync(candidate)) continue // Virtual build-plugin inputs have no filesystem path.
      const resolved = fs.realpathSync(candidate)
      const relative = path.relative(rootDir, resolved)
      if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) continue
      if (resolved.split(path.sep).includes("node_modules")) continue // Existing third-party cache only.
      throw new Error(`Webview build consumed source outside this checkout: ${resolved}`)
    }
  }

  console.log("[build-existing-web] Build completed successfully:")
  const distFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  for (const f of distFiles) {
    const sz = (fs.statSync(path.join(distDir, f)).size / 1024).toFixed(1)
    console.log(` - dist/${f} (${sz} KB)`)
  }
}

main().catch((err) => {
  console.error("[build-existing-web] Build failed:", err)
  process.exit(1)
})
