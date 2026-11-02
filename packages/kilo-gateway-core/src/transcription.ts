export * as KiloTranscription from "./transcription.js"

import { Effect } from "effect"
import { KiloHeaders } from "./headers.js"
import { request } from "./http.js"
import type { Failure } from "./models.js"
import { KiloServer } from "./server.js"

const TIMEOUT_MS = 120_000

export interface Input {
  readonly model: string
  readonly input_audio: { readonly data: string; readonly format: string }
  readonly language?: string
  readonly prompt?: string
  readonly temperature?: number
}

export interface Output {
  readonly text: string
}

/**
 * Proxies one audio transcription through the Kilo Gateway, as v1 `/kilo/audio/transcriptions` did. The account
 * token and the team header stay in the server; the client only sends the model and the base64 audio.
 */
export function transcribe(scope: {
  server: string
  token?: string
  organizationID?: string | null
  version?: string
}, input: Input): Effect.Effect<Output, Failure> {
  return Effect.gen(function* () {
    const server = KiloServer.normalize(scope.server)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...KiloHeaders.provider({ version: scope.version ?? "unknown", organizationID: scope.organizationID ?? null }),
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(
      `${KiloServer.gateway(server)}/audio/transcriptions`,
      { method: "POST", headers, body: JSON.stringify(input) },
      "Speech to text failed",
      TIMEOUT_MS,
    ).pipe(Effect.mapError((): Failure => ({ kind: "network" })))
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
      return yield* Effect.fail({ kind, status: response.status } satisfies Failure)
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (): Failure => ({ kind: "schema" }),
    })
    const text =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).text === "string"
        ? (body as { text: string }).text
        : undefined
    if (text === undefined) return yield* Effect.fail({ kind: "schema" } satisfies Failure)
    return { text }
  })
}
