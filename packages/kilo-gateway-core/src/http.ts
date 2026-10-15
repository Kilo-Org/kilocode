import { Effect } from "effect"

const TIMEOUT_MS = 10_000

// Runs `fetch` with a request timeout and aborts it when the Effect fiber is interrupted.
export function request(url: string, init: RequestInit, label: string, timeoutMs = TIMEOUT_MS) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, timeoutMs))]) }),
    catch: (cause) =>
      new Error(
        cause instanceof Error && cause.name === "TimeoutError"
          ? `${label}: request timed out`
          : `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  })
}

export function json(response: Response, label: string): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () => new Error(`${label}: response was not JSON`),
  })
}
