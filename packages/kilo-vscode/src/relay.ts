// Host side of the webview fetch bridge (relay) (see webview/transport.ts). It adds the server credentials, sends the request
// to the server and streams the response back to the webview.
import type { Request, ToHost, ToWebview } from "./protocol"

export type Target = { url: string; authorization: string }

export function bridge(input: {
  target: () => Promise<Target>
  post: (message: ToWebview) => void
  open?: (url: string) => void
  fetch?: typeof globalThis.fetch
}) {
  const requests = new Map<number, AbortController>()
  const run = input.fetch ?? globalThis.fetch

  const send = async (message: Request) => {
    const abort = new AbortController()
    requests.set(message.id, abort)
    const result = await (async () => {
      const target = await input.target()
      const url = new URL(message.path, target.url)
      // The credential only goes to the server: the path comes from the webview and must stay on its origin.
      if (!message.path.startsWith("/") || url.origin !== new URL(target.url).origin)
        throw new Error(`Refused request outside the Kilo server: ${message.path}`)
      const headers = new Headers(message.headers)
      headers.set("authorization", target.authorization)
      const response = await run(url.href, {
        method: message.method,
        headers,
        body: message.body,
        signal: abort.signal,
      })
      input.post({
        type: "response",
        id: message.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      })
      if (!response.body) return
      for await (const data of response.body) input.post({ type: "chunk", id: message.id, data })
    })().then(
      () => undefined,
      (error: unknown) => error,
    )
    requests.delete(message.id)
    if (abort.signal.aborted) return
    if (result === undefined) return input.post({ type: "end", id: message.id })
    input.post({ type: "error", id: message.id, message: result instanceof Error ? result.message : String(result) })
  }

  return {
    receive(message: ToHost) {
      if (message.type === "fetch") return void send(message)
      if (message.type === "abort") return requests.get(message.id)?.abort()
      if (message.type === "open") input.open?.(message.url)
    },
    dispose() {
      requests.forEach((abort) => abort.abort())
      requests.clear()
    },
  }
}
