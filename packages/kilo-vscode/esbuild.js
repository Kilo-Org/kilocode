const esbuild = require("esbuild")
const os = require("os")
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
 *
 * Entries are content addressed and live in the OS temp dir, so every git
 * worktree of this repo shares one cache and a fresh Agent Manager worktree
 * starts warm instead of re-transforming every JSX file on its first build.
 * A small per-worktree index maps a path to the entry recorded for it, so an
 * unchanged file costs one stat instead of a read and a hash. See the notes
 * on the index below.
 */
const solidCacheDir = path.join(os.tmpdir(), `kilo-vscode-esbuild-solid-${process.getuid?.() ?? "user"}`)
const solidMemCache = new Map()

// Cache entries are read by the bundler, so they are only used when the
// current user owns a directory that other users cannot write to, reached
// without following a link. os.tmpdir() is world writable on Linux, where
// another local user could pre-create this path, as a directory to poison or
// as a symlink that redirects the chmod and the sweep into another
// directory. An untrusted path falls back to memory only.
const diskCache = (() => {
  try {
    fs.mkdirSync(solidCacheDir, { recursive: true, mode: 0o700 })
    // lstat, not stat: stat follows a symlink and would inspect the target.
    const st = fs.lstatSync(solidCacheDir)
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error("cache path is not a real directory")
    }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
      throw new Error(`directory is owned by uid ${st.uid}`)
    }
    const temp = fs.realpathSync(os.tmpdir())
    if (fs.realpathSync(solidCacheDir) !== path.join(temp, path.basename(solidCacheDir))) {
      throw new Error("cache path escapes the temp dir")
    }
    // mkdir does not change the mode of an existing directory.
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
      fs.chmodSync(solidCacheDir, 0o700)
    }
    return true
  } catch (err) {
    console.warn("[esbuild] ignoring unusable solid cache directory, using memory cache only", err)
    return false
  }
})()

// Reclaim disk cache files that are no longer useful: temp files left behind
// by a build killed between writing and renaming, and entries old enough to
// be considered superseded. Entries are content addressed and recomputed on
// a miss, so removing them is always safe. One unreadable file must not
// abort the sweep. This runs at most once a day: the directory is shared by
// every worktree and retains entries for 30 days, so sweeping on every build
// would charge every build for a directory that keeps growing.
if (diskCache) {
  const stamp = path.join(solidCacheDir, ".sweep")
  const period = 24 * 60 * 60 * 1000
  const due = (() => {
    try {
      return Date.now() - fs.statSync(stamp).mtimeMs > period
    } catch (err) {
      if (err.code !== "ENOENT") console.warn("[esbuild] could not read the sweep stamp", err)
      return true
    }
  })()

  if (due) {
    const now = Date.now()
    const age = { ".tmp": 60 * 60 * 1000, ".js": 30 * 24 * 60 * 60 * 1000, ".json": 30 * 24 * 60 * 60 * 1000 }
    const sweep = (file) => {
      const limit = age[path.extname(file)]
      if (limit === undefined) return
      const full = path.join(solidCacheDir, file)
      try {
        if (now - fs.statSync(full).mtimeMs > limit) fs.rmSync(full, { force: true })
      } catch (err) {
        console.warn("[esbuild] could not reclaim a solid cache file", full, err)
      }
    }

    try {
      fs.readdirSync(solidCacheDir).forEach(sweep)
      fs.writeFileSync(stamp, "")
    } catch (err) {
      console.warn("[esbuild] could not sweep the solid cache directory", err)
    }
  }
}

// Deriving a content-addressed key needs the source text, but reading every
// file on every build is wasteful. Remember the key recorded for a path while
// its size and mtime are unchanged, the same trust a size-and-mtime cache
// uses, and keep the index per worktree so worktrees never contend on it.
// The entry a key points at is still content addressed, so sharing one cache
// between worktrees stays exact.
const indexPath = path.join(
  solidCacheDir,
  `index-${crypto.createHash("sha256").update(__dirname).digest("hex").slice(0, 16)}.json`,
)
const index = new Map()

if (diskCache) {
  try {
    const saved = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    for (const [file, value] of Object.entries(saved ?? {})) {
      if (!value || typeof value !== "object") continue
      if (typeof value.mtime !== "number" || typeof value.size !== "number") continue
      if (typeof value.ctime !== "number" || typeof value.key !== "string") continue
      index.set(file, { mtime: value.mtime, size: value.size, ctime: value.ctime, key: value.key })
    }
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("[esbuild] ignoring unusable solid cache index", err)
  }
}

// The index persists between builds: it is seeded from the previous run and
// topped up with the keys this run recorded. Entries whose file no longer
// exists are dropped on save, so renames and deletions do not accumulate.
function saveIndex() {
  if (!diskCache || index.size === 0) return
  for (const file of index.keys()) {
    if (!fs.existsSync(file)) index.delete(file)
  }
  const tmp = `${indexPath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(index)))
    fs.renameSync(tmp, indexPath)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    console.warn("[esbuild] could not save the solid cache index", err)
  }
}

process.on("exit", saveIndex)

// Version of a package as resolved from another package's directory, so the
// cache key follows the transitive dependency that does the actual transform.
function version(name, from) {
  const dir = path.dirname(require.resolve(`${from}/package.json`))
  try {
    return require(require.resolve(`${name}/package.json`, { paths: [dir] })).version || ""
  } catch (err) {
    console.warn(`[esbuild] could not resolve ${name} from ${from}`, err)
    return ""
  }
}

const buildScriptHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(__filename, "utf8"))
  .update(require("@babel/core/package.json").version || "")
  .update(require("babel-preset-solid/package.json").version || "")
  .update(version("babel-plugin-jsx-dom-expressions", "babel-preset-solid"))
  .update(require("@babel/preset-typescript/package.json").version || "")
  .update(version("@babel/plugin-transform-typescript", "@babel/preset-typescript"))
  .digest("hex")
  .slice(0, 8)

// Content key for one source file. The transform output depends only on the
// file name (for the inline source map), the source text, and the toolchain.
function key(source, file) {
  const { name, ext } = path.parse(file)
  return crypto
    .createHash("sha256")
    .update(name + ext)
    .update("\0")
    .update(source)
    .update("\0")
    .update(buildScriptHash)
    .digest("hex")
}

const cachedSolidPlugin = {
  name: "esbuild:solid-cached",
  setup(build) {
    build.onLoad({ filter: /\.(t|j)sx$/ }, async (args) => {
      const st = fs.statSync(args.path)
      const recorded = index.get(args.path)
      // Trust a recorded key only when the file is older than the coarsest
      // filesystem mtime granularity and its metadata has not moved since the
      // key was recorded. ctime changes on every write and cannot be set by
      // tools that preserve mtime, such as cp -p or rsync -t, so a restored
      // file is read again. Anything not trusted is hashed as before.
      const settled = Date.now() - st.mtimeMs > 3000
      const known =
        settled &&
        recorded !== undefined &&
        recorded.mtime === st.mtimeMs &&
        recorded.ctime === st.ctimeMs &&
        recorded.size === st.size
      // Read the file only when its key is not already recorded, so an
      // unchanged file costs one stat instead of a read and a hash.
      const source = known ? undefined : fs.readFileSync(args.path, "utf8")
      const cacheKey = known ? recorded.key : key(source, args.path)
      if (!known) index.set(args.path, { mtime: st.mtimeMs, size: st.size, ctime: st.ctimeMs, key: cacheKey })

      const memHit = solidMemCache.get(cacheKey)
      if (memHit) return { contents: memHit, loader: "js" }

      const diskPath = path.join(solidCacheDir, cacheKey + ".js")

      if (diskCache && fs.existsSync(diskPath)) {
        try {
          const diskCode = fs.readFileSync(diskPath, "utf8")
          solidMemCache.set(cacheKey, diskCode)
          return { contents: diskCode, loader: "js" }
        } catch (err) {
          console.warn("[esbuild] cache read failed, rebuilding", diskPath, err)
        }
      }

      const result = await core.transformAsync(source ?? fs.readFileSync(args.path, "utf8"), {
        presets: [
          [solid, {}],
          [ts, {}],
        ],
        filename: path.basename(args.path),
        sourceMaps: "inline",
      })

      if (result?.code === void 0 || result.code === null) {
        throw new Error("No result was provided from Babel")
      }

      if (solidMemCache.size > 2000) solidMemCache.clear()
      solidMemCache.set(cacheKey, result.code)
      if (diskCache) {
        // Write through a temp file and rename so a concurrent build in
        // another worktree never reads a partially written entry.
        const tmp = `${diskPath}.${process.pid}.${crypto.randomUUID()}.tmp`
        try {
          fs.writeFileSync(tmp, result.code)
          fs.renameSync(tmp, diskPath)
        } catch (err) {
          fs.rmSync(tmp, { force: true })
          console.warn("[esbuild] cache write failed", diskPath, err)
        }
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

/**
 * The DotLottie player defaults to a CDN for its WASM renderer. Ship the copy from
 * `@lottiefiles/dotlottie-web` next to the webview bundles so the animated Kilo logo never
 * reaches the network (the webview CSP blocks it anyway).
 */
function wasm() {
  const root = path.dirname(require.resolve("@lottiefiles/dotlottie-web/package.json"))
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true })
  fs.copyFileSync(
    path.join(root, "dist", "dotlottie-player.wasm"),
    path.join(__dirname, "dist", "dotlottie-player.wasm"),
  )
}

async function main() {
  notices()
  wasm()
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
