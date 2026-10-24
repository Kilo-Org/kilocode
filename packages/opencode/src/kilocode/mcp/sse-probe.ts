/**
 * Some MCP servers answer the optional GET stream probe with `200` and a body that is not an
 * event stream, for example an HTML error page from a proxy in front of the server.
 *
 * The SDK does not check the content type on that probe. It hands the body to the SSE reader,
 * sees a stream that ends without a response, and reconnects on its own schedule: every `200`
 * re-enters the reader and reschedules with a zero attempt count, so the reconnection settings
 * never stop it. The endpoint is then requested once per interval, forever.
 *
 * The spec already answers "this endpoint has no stream" with `405`, and the SDK returns from the
 * probe cleanly on it, so normalize the response instead of patching the SDK.
 *
 * Normalization is scoped to the optional stream request only: a GET with an SSE `Accept` header to
 * the MCP endpoint, or to a same-origin redirect target of that request. The SDK follows those
 * redirects itself and calls this wrapper again with the target, so each target is recorded from the
 * endpoint's redirect response and consumed by the hop that uses it.
 *
 * The URL check is what keeps everything else out. The same fetch wrapper also serves OAuth
 * discovery, registration, and token requests, and rewriting any of those would break
 * authentication. The `Accept` header cannot tell them apart: the SDK merges user-configured MCP
 * headers into discovery requests, so an `Accept: application/json, text/event-stream` header
 * reaches discovery too, and resource metadata may live at any same-origin path. When [endpoint] is
 * omitted the method and Accept checks still apply, which keeps the wrapper safe for other callers.
 */

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function acceptsEventStream(init: RequestInit | undefined, request: RequestInfo | URL): boolean {
  const raw = init?.headers ?? (request instanceof Request ? request.headers : undefined)
  if (!raw) return false
  const accept =
    raw instanceof Headers
      ? raw.get("accept")
      : Array.isArray(raw)
        ? raw.find(([key]) => key.toLowerCase() === "accept")?.[1]
        : ((raw as Record<string, string>).accept ?? (raw as Record<string, string>).Accept)
  return !!accept && accept.toLowerCase().includes("text/event-stream")
}

export const probe = (base: Request = fetch, endpoint?: string) => {
  // Same-origin redirect targets of the stream request, each consumed by the hop that follows it.
  const hops = new Set<string>()
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const hop = hops.delete(url)
    const response = await base(input, init)
    if (endpoint && url !== endpoint && !hop) return response
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    if (method !== "GET") return response
    if (!acceptsEventStream(init, input)) return response
    if (endpoint && response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      const target = location && URL.canParse(location, url) ? new URL(location, url) : undefined
      if (target && target.origin === new URL(url).origin) hops.add(target.href)
      return response
    }
    if (!response.ok) return response
    const type = response.headers.get("content-type")?.toLowerCase()
    if (!type || type.includes("text/event-stream")) return response
    await response.body?.cancel()
    return new Response(null, { status: 405 })
  }
}
