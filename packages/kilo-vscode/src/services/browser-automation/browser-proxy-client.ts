import { Worker } from "node:worker_threads"
import type { BrowserProxyConfig, BrowserProxyHandle } from "./browser-proxy"

export async function startBrowserProxyWorker(onFailure: () => void): Promise<BrowserProxyHandle> {
  // Bun rewrites __dirname and literal require.resolve calls at build time. Resolve beside the installed host.
  const resolve = require.resolve
  const worker = new Worker(resolve("./browser-proxy-worker.js"), { execArgv: [] })
  const ready = Promise.withResolvers<BrowserProxyConfig>()
  let started = false
  let closing: Promise<void> | undefined

  worker.once("message", (config: BrowserProxyConfig) => {
    started = true
    ready.resolve(config)
  })
  worker.once("error", () => ready.reject(new Error("Browser proxy worker failed to start")))
  // Node emits exit after an uncaught worker error. An unsolicited clean exit also loses the proxy.
  worker.once("exit", () => {
    if (!started) return ready.reject(new Error("Browser proxy worker exited before startup"))
    if (!closing) onFailure()
  })

  const config = await ready.promise
  return {
    proxy: Object.freeze(config.proxy),
    credentials: Object.freeze(config.credentials),
    // The worker owns the listener and every tunnel. Its exit is the teardown barrier for all of them.
    close: () => (closing ??= worker.terminate().then(() => undefined)),
  }
}
