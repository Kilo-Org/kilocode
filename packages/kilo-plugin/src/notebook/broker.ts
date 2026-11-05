import { KiloNotebook } from "@opencode/schema/kilocode/notebook"
import { Schema } from "effect"
import { readEndpoint, takeEndpoint, type Endpoint } from "../broker"

const TIMEOUT = 10 * 60_000

export const PATH = "/notebook/request"

const captured: { endpoint?: Endpoint } = {}

export function broker(): Endpoint | undefined {
  return readEndpoint("KILO_NOTEBOOK_BROKER")
}

export function takeBroker() {
  return takeEndpoint("KILO_NOTEBOOK_BROKER", captured)
}

export type { Endpoint }

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
