import { HostedError, SessionUnavailable } from "./error.js"

export const invalidResponse = () => new HostedError("Cloud returned an invalid session response.")

/** Link is never followed: only a bounded, opaque cursor can enter a fixed history route. */
export function cursor(value: string) {
  if (value.length > 2048 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw invalidResponse()
  return value
}

export function segment(value: string) {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(value)) throw new HostedError("Invalid Cloud session identifier.")
  return value
}

export async function checkResponse(response: Response) {
  if (response.ok) return
  await response.body?.cancel().catch(() => {})
  switch (response.status) {
    case 401:
    case 403:
      throw new SessionUnavailable("Cloud session access was denied.")
    case 402:
      throw new HostedError("Cloud requires a positive balance for this request.")
    case 404:
    case 410:
      throw new SessionUnavailable("Cloud session no longer exists.")
    case 409:
      throw new HostedError("Cloud cannot accept this action in the current session state.")
    default:
      throw new HostedError("Cloud could not complete the session request.")
  }
}

/** A deadline must cover consuming the body, not just receiving the HTTP headers. */
async function* chunks(response: Response, signal: AbortSignal) {
  if (!response.body) throw invalidResponse()
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      signal.throwIfAborted()
      if (result.done) return
      yield result.value
    }
  } finally {
    signal.removeEventListener("abort", cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function json(response: Response, signal: AbortSignal, limit: number): Promise<unknown> {
  await checkResponse(response)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let size = 0
  let text = ""
  for await (const chunk of chunks(response, signal)) {
    size += chunk.byteLength
    if (size > limit) throw new HostedError("Cloud session response is too large.")
    text += decoder.decode(chunk, { stream: true })
  }
  return JSON.parse(text + decoder.decode())
}

// The facade sends at most 256 KiB per event. Permit the data prefix, line breaks and UTF-8 boundaries.
const FRAME_LIMIT = 264 * 1024

/** Consume complete SSE records, including across CRLF and split UTF-8 sequences. */
export async function* frames(response: Response, signal: AbortSignal, heartbeat: () => void) {
  await checkResponse(response)
  if (response.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream") {
    await response.body?.cancel()
    throw invalidResponse()
  }
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let pending = ""
  let data = ""
  for await (const chunk of chunks(response, signal)) {
    heartbeat()
    pending += decoder.decode(chunk, { stream: true })
    let end = pending.indexOf("\n")
    while (end !== -1) {
      if (end + data.length > FRAME_LIMIT) throw invalidResponse()
      const line = pending.slice(0, end).replace(/\r$/, "")
      pending = pending.slice(end + 1)
      if (!line && data) {
        yield JSON.parse(data) as unknown
        data = ""
      }
      if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "") + "\n"
      end = pending.indexOf("\n")
    }
    if (pending.length + data.length > FRAME_LIMIT) throw invalidResponse()
  }
}
