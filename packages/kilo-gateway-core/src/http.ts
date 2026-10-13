import { Effect, Schema } from "effect"

export const TIMEOUT = 10_000

// Interrupting the returned effect aborts the request. The timeout also covers reading the body.
export function request(url: string, init?: RequestInit, timeout = TIMEOUT) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) }),
    catch: (cause) => new Error(`Kilo request failed: ${new URL(url).pathname}`, { cause }),
  })
}

export function json<A>(response: Response, schema: Schema.Codec<A, unknown>) {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((cause) => new Error("Invalid Kilo response", { cause })),
  )
}
