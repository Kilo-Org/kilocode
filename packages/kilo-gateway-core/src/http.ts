import { Effect, Schema } from "effect"

// Interrupting the returned effect aborts the request.
export function request(url: string, init?: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
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
