import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { BrowserContext } from "playwright-core"
import type { BrowserContextFactory } from "./browser-broker"
import { BrowserProxy, type BrowserProxyHandle } from "./browser-proxy"
import { startBrowserProxyWorker } from "./browser-proxy-client"

const MAX_BODY = 32 * 1024

export function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Browser developer tools did not receive a local port")))
        return
      }
      server.close((error) => {
        if (error) return reject(error)
        resolve(address.port)
      })
    })
  })
}

export function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  res.end(body)
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error("Request body is too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

export async function openBrowserPage(
  browser: BrowserContextFactory,
  url: URL,
  options: {
    colorScheme: "dark" | "light"
    proxyWorker?: boolean
    proxies: Set<BrowserProxyHandle>
    available: () => void
    log: (...args: unknown[]) => void
  },
) {
  const failure = new AbortController()
  const proxy = options.proxyWorker
    ? await startBrowserProxyWorker(() => failure.abort(new Error("Browser proxy stopped unexpectedly.")))
    : await BrowserProxy.start(url.protocol === "http:" ? url : "public")
  options.proxies.add(proxy)
  let context: BrowserContext | undefined
  try {
    options.available()
    context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      colorScheme: options.colorScheme,
      proxy: proxy.proxy,
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
    })
    failure.signal.throwIfAborted()
    const page = await context.newPage()
    failure.signal.throwIfAborted()
    return { context, page, proxy, failure: failure.signal }
  } catch (error) {
    await proxy.close()
    options.proxies.delete(proxy)
    await context?.close().catch((cause: unknown) => options.log("Browser context close failed", cause))
    throw error
  }
}
