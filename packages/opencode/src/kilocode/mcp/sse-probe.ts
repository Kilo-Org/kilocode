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
 */

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const probe = (base: Request = fetch) => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await base(input, init)
    if (init?.method !== "GET" || !response.ok) return response
    const type = response.headers.get("content-type")?.toLowerCase()
    if (!type || type.includes("text/event-stream")) return response
    await response.body?.cancel()
    return new Response(null, { status: 405 })
  }
}
