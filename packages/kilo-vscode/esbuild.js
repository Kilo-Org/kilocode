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
 * Stub the pierre worker module so the Diff/Code components work without
 * web workers in the VS Code webview. The `@pierre/diffs` library handles
 * undefined worker pools gracefully (renders without syntax highlighting).
 *
 * We stub the entire worker module rather than just the URL import because
 * `new Worker('')` would throw at runtime.
 *
 * @type {import('esbuild').Plugin}
 */
const pierreWorkerStubPlugin = {
  name: "pierre-worker-stub",
  setup(build) {
    // Stub the Vite-specific ?worker&url import
    build.onResolve({ filter: /\?worker&url$/ }, (args) => ({
      path: args.path,
      namespace: "worker-url-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "worker-url-stub" }, () => ({
      contents: "export default ''",
      loader: "js",
    }))

    // Stub the pierre worker module so getWorkerPool always returns undefined
    build.onResolve({ filter: /pierre\/worker$/ }, (args) => {
      // Only stub the local UI worker module, not @pierre/diffs/worker
      if (args.path.includes("@pierre")) return
      return {
        path: args.path,
        namespace: "pierre-worker-stub",
      }
    })
    build.onLoad({ filter: /.*/, namespace: "pierre-worker-stub" }, () => ({
      contents: `
        export function getWorkerPool() { return undefined }
        export function getWorkerPools() { return { unified: undefined, split: undefined } }
        export function workerFactory() { return undefined }
      `,
      loader: "js",
    }))
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

  // Build Agent Manager webview (SolidJS, shares components with sidebar)
  const agentManagerCtx = await esbuild.context({
    entryPoints: ["webview-ui/agent-manager/index.tsx"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/agent-manager.js",
    logLevel: "silent",
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
    },
    plugins: [
      solidDedupePlugin,
      pierreWorkerStubPlugin,
      cssPackageResolvePlugin,
      solidPlugin(),
      esbuildProblemMatcherPlugin,
    ],
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
    plugins: [
      solidDedupePlugin,
      pierreWorkerStubPlugin,
      cssPackageResolvePlugin,
      solidPlugin(),
      esbuildProblemMatcherPlugin,
    ],
  })

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch(), agentManagerCtx.watch()])
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild(), agentManagerCtx.rebuild()])
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose(), agentManagerCtx.dispose()])
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
