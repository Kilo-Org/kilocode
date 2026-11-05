import { KiloNotebook } from "@opencode/schema/kilocode/notebook"
import { Schema } from "effect"

const TIMEOUT = 10 * 60_000

export const PATH = "/notebook/request"

/**
 * The endpoint the VS Code extension prints into the server environment. Its broker listens on loopback only, so
 * any other origin, a path, or credentials mean the value did not come from this host.
 */
export function broker(): { url: URL; token: string } | undefined {
  const base = process.env.KILO_NOTEBOOK_BROKER_URL
  const token = process.env.KILO_NOTEBOOK_BROKER_TOKEN
  if (!base || !token || !URL.canParse(base)) return undefined
  const url = new URL(base)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return undefined
  }
  return { url, token }
}

const captured: { endpoint?: { url: URL; token: string } } = {}

/**
 * Read the broker endpoint once and remove it from the process environment. Tools and MCP servers inherit this
 * environment, so leaving the token there would let a shell command drive notebooks without the permission prompt.
 * The plugin effect runs again for each Location and after each plugin reload, so later calls return the captured
 * endpoint.
 */
export function takeBroker() {
  const endpoint = broker()
  if (!endpoint) return captured.endpoint
  captured.endpoint = endpoint
  delete process.env.KILO_NOTEBOOK_BROKER_URL
  delete process.env.KILO_NOTEBOOK_BROKER_TOKEN
  return endpoint
}

export type Endpoint = { url: URL; token: string }

/**
 * One broker call. The host aborts its work when the connection closes, so an interrupted tool or the timeout stops
 * a running cell instead of leaving it behind.
 */
export async function send(input: {
  endpoint: Endpoint
  request: KiloNotebook.Request
  signal: AbortSignal
}): Promise<KiloNotebook.Reply> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, TIMEOUT)
  input.signal.addEventListener("abort", abort, { once: true })
  if (input.signal.aborted) abort()
  try {
    const response = await fetch(new URL(PATH, input.endpoint.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.endpoint.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.request),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => undefined)
    if (response.status < 200 || response.status >= 300) {
      const message =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : `Notebook host answered HTTP ${response.status}`
      throw new Error(message)
    }
    return Schema.decodeUnknownSync(KiloNotebook.Reply)(body)
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", abort)
  }
}
