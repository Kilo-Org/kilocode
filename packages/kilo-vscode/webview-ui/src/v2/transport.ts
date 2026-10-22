// A `fetch` for `@opencode/client` that sends each request through the extension host (see src/relay.ts).
import type { ToHost, ToWebview } from "../../../src/protocol"

type Pending = {
  response: PromiseWithResolvers<Response>
  stream?: ReadableStreamDefaultController<Uint8Array>
}

export function transport(post: (message: ToHost) => void) {
  const pending = new Map<number, Pending>()
  const state = { next: 0 }

  const fail = (id: number, error: unknown) => {
    const item = pending.get(id)
    if (!item) return
    pending.delete(id)
    item.response.reject(error)
    item.stream?.error(error)
  }

  const receive = (message: ToWebview) => {
    if (message.type !== "response" && message.type !== "chunk" && message.type !== "end" && message.type !== "error") return
    const item = pending.get(message.id)
    if (!item) return
    if (message.type === "response") {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          item.stream = controller
        },
        cancel: () => {
          pending.delete(message.id)
          post({ type: "abort", id: message.id })
        },
      })
      const empty = message.status === 204 || message.status === 304
      item.response.resolve(
        new Response(empty ? null : body, {
          status: message.status,
          statusText: message.statusText,
          headers: message.headers,
        }),
      )
      return
    }
    if (message.type === "chunk") return item.stream?.enqueue(message.data)
    if (message.type === "end") {
      pending.delete(message.id)
      return item.stream?.close()
    }
    fail(message.id, new TypeError(message.message))
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const id = ++state.next
    const item: Pending = { response: Promise.withResolvers<Response>() }
    if (request.signal.aborted) throw abortError(request.signal)
    pending.set(id, item)
    request.signal.addEventListener(
      "abort",
      () => {
        if (!pending.has(id)) return
        post({ type: "abort", id })
        fail(id, abortError(request.signal))
      },
      { once: true },
    )
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
    post({
      type: "fetch",
      id,
      path: url.pathname + url.search,
      method: request.method,
      headers: [...request.headers.entries()],
      body,
    })
    return item.response.promise
  }

  return { fetch: fetch as typeof globalThis.fetch, receive }
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError")
}
