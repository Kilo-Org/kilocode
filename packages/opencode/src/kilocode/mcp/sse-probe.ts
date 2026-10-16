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
 * Normalization is scoped to the optional stream request only: a GET to the MCP endpoint with an
 * SSE `Accept` header. The same fetch wrapper also serves OAuth discovery, registration, and token
 * requests, and rewriting any of those would break authentication. When [endpoint] is omitted the
 * method and Accept checks still apply, which keeps the wrapper safe for other callers.
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
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await base(input, init)
    if (endpoint && requestUrl(input) !== endpoint) return response
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    if (method !== "GET" || !response.ok) return response
    if (!acceptsEventStream(init, input)) return response
    const type = response.headers.get("content-type")?.toLowerCase()
    if (!type || type.includes("text/event-stream")) return response
    await response.body?.cancel()
    return new Response(null, { status: 405 })
  }
}
