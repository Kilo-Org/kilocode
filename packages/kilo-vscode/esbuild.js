const esbuild = require("esbuild")
const path = require("path")
const fs = require("fs")
const crypto = require("crypto")
const core = require("@babel/core")
const solid = require("babel-preset-solid")
const ts = require("@babel/preset-typescript")
const playwright = require("./script/playwright-runtime")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/**
 * Cache transformed Solid JSX files in memory and on disk to avoid
 * re-parsing and re-transforming unchanged files across builds and webviews.
 */
const solidCacheDir = path.join(__dirname, "node_modules", ".cache", "esbuild-solid")
const solidMemCache = new Map()
const buildScriptHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(__filename, "utf8"))
  .update(require("babel-preset-solid/package.json").version || "")
  .update(require("@babel/preset-typescript/package.json").version || "")
  .digest("hex")
  .slice(0, 8)

if (!fs.existsSync(solidCacheDir)) {
  try {
    fs.mkdirSync(solidCacheDir, { recursive: true })
  } catch (err) {
    console.warn("[esbuild] could not create solid cache directory", err)
  }
}

const cachedSolidPlugin = {
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

      if (result?.code === void 0 || result.code === null) {
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

/**
 * Force all solid-js imports (from kilo-ui and the webview) to resolve to
 * the **same** copy so SolidJS contexts are shared across packages.
 * Without this, the monorepo hoists separate copies (pnpm vs bun) and
 * createContext / useContext can't see each other.
 *
 * @type {import('esbuild').Plugin}
 */
const solidDedupePlugin = {
  name: "solid-dedupe",
  setup(build) {
    // Resolve these bare specifiers to the kilo-vscode-local copy
    const solidRoot = path.dirname(require.resolve("solid-js/package.json"))
    const aliases = {
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

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started")
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`)
        }
      })
      console.log("[watch] build finished")
    })
  },
}

/**
 * Route the shared `@opencode-ai/ui/pierre/worker` module (and its relative
 * variants) to the Kilo implementation in `webview-ui/pierre-worker.ts`.
 *
 * The upstream module loads Pierre's Shiki worker via a Vite-only
 * `?worker&url` import that esbuild can't resolve. The Kilo replacement loads
 * the worker from the bundled `dist/shiki-worker.js` asset instead, so syntax
 * highlighting runs off the main thread. `@pierre/diffs/worker` (used by that
 * replacement) is left alone.
 *
 * @type {import('esbuild').Plugin}
 */
const pierreWorkerAliasPlugin = {
  name: "pierre-worker-alias",
  setup(build) {
    build.onResolve({ filter: /pierre\/worker$/ }, (args) => {
      if (args.path.includes("@pierre")) return
      return { path: path.join(__dirname, "webview-ui", "pierre-worker.ts") }
    })
  },
}

/**
 * Replace Markdown's Vite-only worker URL import with the URI injected by the
 * extension host. The worker itself is emitted as a separate dist asset below.
 *
 * @type {import('esbuild').Plugin}
 */
const markdownWorkerUrlPlugin = {
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

/**
 * Resolve the synthetic `kilo-shiki-worker` entry point to Pierre's Shiki worker
 * so esbuild can bundle it (and its inlined oniguruma WebAssembly) into a single
 * `dist/shiki-worker.js` asset loaded by `webview-ui/pierre-worker.ts`. Switch to
 * `worker-portable.js` to drop WebAssembly and use the JS regex engine instead.
 *
 * @type {import('esbuild').Plugin}
 */
const shikiWorkerEntryPlugin = {
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

const svgSpritePlugin = {
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

const cssPackageResolvePlugin = {
  name: "css-package-resolve",
  setup(build) {
    build.onResolve({ filter: /^@/, namespace: "file" }, (args) => {
      if (args.kind === "import-rule") {
        return build.resolve(args.path, {
          kind: "import-statement",
          resolveDir: args.resolveDir,
        })
      }
    })
  },
}

function getExtensionConfig() {
  return {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    // Identifier minification is disabled for the Node.js extension bundle because esbuild
    // renames @aws-sdk/credential-providers re-exports and internal Symbols to the same
    // short identifier in CJS mode, causing "J_ is not a function (J_ is a Symbol)" at
    // runtime. Syntax and whitespace minification are kept; only identifier mangling is off.
    minifyIdentifiers: false,
    minifySyntax: production,
    minifyWhitespace: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [playwright, ...(watch ? [esbuildProblemMatcherPlugin] : [])],
  }
}

function getWebviewsConfig() {
  return {
    entryPoints: {
      "agent-manager": "webview-ui/agent-manager/index.tsx",
      kiloclaw: "webview-ui/kiloclaw/index.tsx",
      marketplace: "webview-ui/marketplace/index.tsx",
      "diff-viewer": "webview-ui/diff-viewer/index.tsx",
      documents: "webview-ui/documents/index.tsx",
      "diff-virtual": "webview-ui/diff-virtual/index.tsx",
      webview: "webview-ui/src/index.tsx",
    },
    outdir: "dist",
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    logLevel: "silent",
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
      cachedSolidPlugin,
      ...(watch ? [esbuildProblemMatcherPlugin] : []),
    ],
  }
}

function getShikiWorkerConfig() {
  return {
    entryPoints: ["kilo-shiki-worker"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/shiki-worker.js",
    logLevel: "silent",
    plugins: [shikiWorkerEntryPlugin, ...(watch ? [esbuildProblemMatcherPlugin] : [])],
  }
}

function getMarkdownShikiWorkerConfig() {
  return {
    entryPoints: [path.join(__dirname, "..", "ui", "src", "components", "markdown-shiki.worker.ts")],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/markdown-shiki-worker.js",
    logLevel: "silent",
    plugins: watch ? [esbuildProblemMatcherPlugin] : [],
  }
}

function notices() {
  const deps = {
    "playwright-core": ["LICENSE", "NOTICE", "ThirdPartyNotices.txt"],
    "chromium-bidi": ["LICENSE"],
  }
  for (const [name, files] of Object.entries(deps)) {
    const root = path.dirname(require.resolve(`${name}/package.json`))
    const dir = path.join(__dirname, "dist", "licenses", name)
    fs.mkdirSync(dir, { recursive: true })
    for (const file of files) fs.copyFileSync(path.join(root, file), path.join(dir, file))
  }
}

async function main() {
  notices()
  const extensionConfig = getExtensionConfig()
  const webviewsConfig = getWebviewsConfig()
  const shikiWorkerConfig = getShikiWorkerConfig()
  const markdownShikiWorkerConfig = getMarkdownShikiWorkerConfig()

  if (watch) {
    const [extensionCtx, webviewsCtx, shikiWorkerCtx, markdownShikiWorkerCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewsConfig),
      esbuild.context(shikiWorkerConfig),
      esbuild.context(markdownShikiWorkerConfig),
    ])

    await Promise.all([
      extensionCtx.watch(),
      webviewsCtx.watch(),
      shikiWorkerCtx.watch(),
      markdownShikiWorkerCtx.watch(),
    ])
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewsConfig),
      esbuild.build(shikiWorkerConfig),
      esbuild.build(markdownShikiWorkerConfig),
    ])
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
