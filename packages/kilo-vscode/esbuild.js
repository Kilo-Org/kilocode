const esbuild = require("esbuild")
const path = require("path")
const { solidPlugin } = require("esbuild-plugin-solid")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

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
 * Handle Vite-specific `?worker&url` import suffix used by @pierre/diffs.
 * Strips the query suffix and re-resolves via esbuild with the `file` loader
 * so the import returns a URL string at runtime.
 *
 * @type {import('esbuild').Plugin}
 */
const workerUrlPlugin = {
  name: "worker-url",
  setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, async (args) => {
      const bare = args.path.replace(/\?worker&url$/, "")
      const result = await build.resolve(bare, {
        kind: "import-statement",
        resolveDir: args.resolveDir,
      })
      if (result.errors.length > 0) return { errors: result.errors }
      return { path: result.path, namespace: "worker-url" }
    })

    build.onLoad({ filter: /.*/, namespace: "worker-url" }, (args) => {
      return { contents: require("fs").readFileSync(args.path), loader: "file" }
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

async function main() {
  // Build extension
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  })

  // Build webview
  const webviewCtx = await esbuild.context({
    entryPoints: ["webview-ui/src/index.tsx"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/webview.js",
    logLevel: "silent",
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
    },
    plugins: [solidDedupePlugin, workerUrlPlugin, cssPackageResolvePlugin, solidPlugin(), esbuildProblemMatcherPlugin],
  })

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()])
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()])
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()])
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
