// Kilo-specific replacement for the shared `@opencode-ai/ui/pierre/worker`
// module (wired up by the pierre-worker-alias plugin in esbuild.js).
//
// The upstream module loads Pierre's Shiki worker through a Vite-only
// `?worker&url` import, which esbuild cannot resolve and which the VS Code
// webview CSP blocks. As a result the webview previously ran syntax
// highlighting synchronously on the main thread (`findNextMatchSync`), which
// froze scrolling on large diffs.
//
// Here we instead load the worker from a real dist asset (`dist/shiki-worker.js`,
// also produced by esbuild.js) using the webview URI the extension injects into
// the page. Pierre can offload highlighted updates to the pool after its initial
// plain render. The diff wrapper still needs to keep that initial render cheap,
// which is why review surfaces pass hunk-bounded patches instead of full files.
import { LINE_DIFF_TYPE } from "@kilocode/kilo-ui/pierre"
import { WorkerPoolManager } from "@pierre/diffs/worker"
import { ensureKiloDiffTheme, KILO_DIFF_THEME } from "@opencode-ai/ui/pierre/kilo-diff-theme"

// Register the "Kilo" theme before any pool initializes. resolveThemes([theme])
// runs on the main thread during initialize() and throws "resolveTheme: No valid
// loader for Kilo" if the theme name was never registered. Registering here makes
// the worker self-sufficient rather than depending on the markdown context module
// having been imported first.
ensureKiloDiffTheme()

export type WorkerPoolStyle = "unified" | "split"

// Oniguruma WebAssembly engine (matches the highlighting quality of the rest of
// the app). The CSP already allows `wasm-unsafe-eval`, and if the worker fails to
// instantiate, WorkerPoolManager falls back to the main-thread highlighter. To
// avoid WebAssembly entirely, build the portable worker and use "shiki-js".
const ENGINE = "shiki-wasm"

function uri(): string | undefined {
  if (typeof window === "undefined") return undefined
  return (window as { KILO_SHIKI_WORKER_URI?: string }).KILO_SHIKI_WORKER_URI
}

export function workerFactory(): Worker {
  const url = uri()
  if (!url) throw new Error("KILO_SHIKI_WORKER_URI is not set")
  return new Worker(url)
}

function createPool() {
  const pool = new WorkerPoolManager(
    { workerFactory, poolSize: 2 },
    { theme: KILO_DIFF_THEME, lineDiffType: LINE_DIFF_TYPE, preferredHighlighter: ENGINE },
  )
  void pool.initialize().catch((err) => console.warn("[Kilo New] Failed to initialize Pierre worker pool", err))
  return pool
}

let unified: WorkerPoolManager | undefined
let split: WorkerPoolManager | undefined

export function getWorkerPool(style: WorkerPoolStyle | undefined): WorkerPoolManager | undefined {
  // A missing URI or a pool still starting up uses Pierre's main-thread fallback.
  // Passing a half-ready pool drops its first plain-text render before workers drain.
  if (!uri()) return undefined

  if (style === "split") {
    if (!split) split = createPool()
    return split.isInitialized() ? split : undefined
  }

  if (!unified) unified = createPool()
  return unified.isInitialized() ? unified : undefined
}

export function getWorkerPools() {
  return {
    unified: getWorkerPool("unified"),
    split: getWorkerPool("split"),
  }
}
