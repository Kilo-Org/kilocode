// A minimal `fetch` over `node:http` for the local server. The extension host replaces the global `fetch` with a
// proxy-aware one that does not stream event-stream responses chunk by chunk, and loopback requests need no proxy.
import { request } from "node:http"

export const local = ((input: RequestInfo | URL, init?: RequestInit) => {
  const target = new Request(input, init)
  const signal = init?.signal ?? undefined
  const result = Promise.withResolvers<Response>()
  if (signal?.aborted) return Promise.reject(signal.reason)
  const req = request(target.url, { method: target.method, headers: Object.fromEntries(target.headers) }, (res) => {
    const status = res.statusCode ?? 500
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        res.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        res.on("end", () => controller.close())
        res.on("error", (error) => controller.error(error))
      },
      cancel() {
        res.destroy()
      },
    })
    const headers = Object.entries(res.headers).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((item): [string, string] => [key, item]),
    )
    result.resolve(
      new Response(status === 204 || status === 304 ? null : body, { status, statusText: res.statusMessage, headers }),
    )
  })
  req.on("error", (error) => result.reject(error))
  signal?.addEventListener("abort", () => req.destroy(signal.reason instanceof Error ? signal.reason : undefined), {
    once: true,
  })
  if (typeof init?.body === "string") req.write(init.body)
  req.end()
  return result.promise
}) as typeof globalThis.fetch
