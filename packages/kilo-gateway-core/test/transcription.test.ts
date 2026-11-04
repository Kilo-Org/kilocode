import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloTranscription } from "../src/index.js"
import { fixture } from "../src/testing.js"

const input = {
  model: "openai/gpt-4o-mini-transcribe",
  input_audio: { data: "AAAA", format: "m4a" },
  language: "en",
}

describe("KiloTranscription", () => {
  test("posts the audio and returns the transcript", async () => {
    using backend = fixture()
    const result = await Effect.runPromise(
      KiloTranscription.transcribe({ server: backend.url, token: "token", organizationID: "org" }, input),
    )
    expect(result).toEqual({ text: "Make the header sticky" })
    expect(backend.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/gateway/audio/transcriptions",
      authorization: "Bearer token",
    })
  })

  test("maps a rejected token to unauthorized", async () => {
    using backend = fixture()
    backend.state.audioTranscriptionsStatus = 401
    const error = await Effect.runPromise(
      Effect.flip(KiloTranscription.transcribe({ server: backend.url, token: "bad" }, input)),
    )
    expect(error).toEqual({ kind: "unauthorized", status: 401 })
  })

  test("rejects a response without a text field", async () => {
    using backend = fixture()
    backend.state.audioTranscriptions = { segments: [] }
    const error = await Effect.runPromise(
      Effect.flip(KiloTranscription.transcribe({ server: backend.url, token: "token" }, input)),
    )
    expect(error).toEqual({ kind: "schema" })
  })
})
