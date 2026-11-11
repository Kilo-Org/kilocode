export * as KiloSseProbe from "./sse-probe.js"

import type { FetchLike } from "@modelcontextprotocol/client"

/**
 * Some servers answer the optional GET stream probe with `200` and a body that is not an event
 * stream, for example an HTML error page from a proxy in front of the server.
 *
 * The SDK does not check the content type on that probe. It hands the body to the SSE reader, sees a
 * stream that ends without a response, and reschedules the probe with a zero attempt count: every
 * `200` re-enters the reader and reschedules again, so the reconnection settings never stop it and
 * the endpoint is requested once per interval, forever. The spec already answers "this endpoint has
 * no stream" with `405`, and the SDK returns from the probe cleanly on it, so normalize the response
 * instead of patching the SDK.
 *
 * Normalization is scoped to the optional stream request only: a GET with an SSE `Accept` header to
 * the MCP endpoint, or to a redirect target the SDK follows for that request. The SDK follows those
 * redirects itself and calls this wrapper again with the target, so each target is recorded from the
 * endpoint's redirect response and consumed by the hop that uses it.
 *
 * The URL check is what keeps everything else out. The same fetch wrapper also serves the
 * transport's OAuth discovery, refresh and step-up requests, and rewriting any of those would break
 * authentication. The `Accept` header cannot tell them apart: configured MCP headers are merged into
 * those requests, so an `Accept: application/json, text/event-stream` header reaches discovery too,
 * and resource metadata may live at any same-origin path.
 */
export const probe = (base: FetchLike, endpoint: string): FetchLike => {
  // Same-origin redirect targets of the stream request, each consumed by the hop that follows it.
  const hops = new Set<string>()
  return async (url, init) => {
    const target = String(url)
    const hop = hops.delete(target)
    const response = await base(url, init)
    if (target !== endpoint && !hop) return response
    if ((init?.method ?? "GET").toUpperCase() !== "GET") return response
    if (!acceptsEventStream(init?.headers)) return response
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      const next = location && URL.canParse(location, target) ? new URL(location, target) : undefined
      if (next && followed(new URL(target), next)) hops.add(next.href)
      return response
    }
    if (!response.ok) return response
    const type = response.headers.get("content-type")?.toLowerCase()
    if (!type || type.includes("text/event-stream")) return response
    await response.body?.cancel()
    return new Response(null, { status: 405 })
  }
}

const acceptsEventStream = (headers: RequestInit["headers"]) => {
  if (!headers) return false
  const value =
    headers instanceof Headers
      ? headers.get("accept")
      : Array.isArray(headers)
        ? headers.find(([key]) => key.toLowerCase() === "accept")?.[1]
        : Object.entries(headers).find(([key]) => key.toLowerCase() === "accept")?.[1]
  const accept = Array.isArray(value) ? value.join(",") : value
  return typeof accept === "string" && accept.toLowerCase().includes("text/event-stream")
}

/** The same rule the SDK's redirect follower uses: same origin, or an http to https upgrade on default ports. */
const followed = (from: URL, to: URL) =>
  from.origin === to.origin ||
  (from.protocol === "http:" &&
    to.protocol === "https:" &&
    from.hostname === to.hostname &&
    from.port === "" &&
    to.port === "")
