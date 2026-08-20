import { afterAll, describe, expect, it } from "bun:test"
import { hasCustomSource, resolveSpeechToTextSource, sourceHeaders, sourceUrl } from "../../src/speech-to-text/source"
import { fetchSpeechToTextModels, parseCustomCatalog } from "../../src/speech-to-text/catalog"
import { transcribeSpeech } from "../../src/speech-to-text/transcribe"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import {
  canUseSpeechToText,
  hasCustomSpeechToTextSource,
  selectedSpeechToTextModel,
} from "../../webview-ui/src/components/speech-to-text/availability"

const offline = { getServerConfig: () => undefined } as unknown as KiloConnectionService

const seen: { path?: string; auth?: string | null; model?: string; file?: string } = {}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    seen.path = url.pathname
    seen.auth = request.headers.get("authorization")

    if (url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "whisper-1" }, { id: "parakeet", name: "Parakeet" }] })
    }

    if (url.pathname === "/denied/audio/transcriptions") {
      return new Response("", { status: 401 })
    }

    if (url.pathname === "/v1/audio/transcriptions") {
      const form = await request.formData()
      seen.model = String(form.get("model"))
      const file = form.get("file")
      seen.file = file instanceof Blob ? await file.text() : ""
      return Response.json({ text: "  hello there  " })
    }

    return new Response("not found", { status: 404 })
  },
})

const base = `http://localhost:${server.port}/v1`

afterAll(() => server.stop(true))

describe("speech-to-text custom source", () => {
  it("resolves a source only when a base URL is configured", () => {
    expect(resolveSpeechToTextSource()).toBeUndefined()
    expect(resolveSpeechToTextSource({ experimental: { speech_to_text_base_url: "   " } })).toBeUndefined()

    const source = resolveSpeechToTextSource({
      experimental: { speech_to_text_base_url: "https://example.test/v1/", speech_to_text_api_key: " key " },
    })
    expect(source).toEqual({ baseUrl: "https://example.test/v1", apiKey: "key" })
    expect(hasCustomSource(source)).toBe(true)
    expect(sourceUrl(source!, "/audio/transcriptions")).toBe("https://example.test/v1/audio/transcriptions")
    expect(sourceHeaders(source!)).toEqual({ Authorization: "Bearer key" })
    expect(sourceHeaders({ baseUrl: "https://example.test" })).toEqual({})
  })

  it("reads the model catalog from an OpenAI-compatible source", async () => {
    const result = await fetchSpeechToTextModels(offline, "", undefined, { baseUrl: base, apiKey: "secret" })

    expect(seen.path).toBe("/v1/models")
    expect(seen.auth).toBe("Bearer secret")
    expect(result).toEqual({
      ok: true,
      models: [
        { id: "whisper-1", label: "whisper-1", provider: `localhost:${server.port}` },
        { id: "parakeet", label: "Parakeet", provider: `localhost:${server.port}` },
      ],
    })
  })

  it("posts audio directly to the source instead of the Kilo backend", async () => {
    const result = await transcribeSpeech(
      offline,
      { model: "whisper-1", data: Buffer.from("audio").toString("base64"), format: "m4a" },
      "",
      undefined,
      { baseUrl: base, apiKey: "secret" },
    )

    expect(seen.path).toBe("/v1/audio/transcriptions")
    expect(seen.model).toBe("whisper-1")
    expect(seen.file).toBe("audio")
    expect(result).toEqual({ ok: true, text: "hello there" })
  })

  it("reports a rejected custom key without asking for a Kilo sign-in", async () => {
    const denied = `http://localhost:${server.port}/denied`
    const result = await transcribeSpeech(offline, { data: "", format: "m4a" }, "", undefined, {
      baseUrl: denied,
      apiKey: "wrong",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a failure")
    expect(result.code).toBeUndefined()
    expect(result.error).toBe(
      `Speech to text was rejected by ${denied} (HTTP 401). Check the API key for that endpoint.`,
    )
  })

  it("still requires the Kilo backend without a custom source", async () => {
    const result = await transcribeSpeech(offline, { data: "", format: "m4a" }, "")
    expect(result).toEqual({ ok: false, error: "Not connected to the Kilo backend", code: "not_connected" })
  })

  it("parses list and data shaped catalogs and rejects empty ones", () => {
    expect(parseCustomCatalog([{ id: "a" }], "https://host.test/v1")).toEqual([
      { id: "a", label: "a", provider: "host.test" },
    ])
    expect(parseCustomCatalog({ data: [] }, "https://host.test/v1")).toBeUndefined()
    expect(parseCustomCatalog({}, "https://host.test/v1")).toBeUndefined()
  })

  it("unlocks voice input and keeps custom model IDs", () => {
    const cfg = {
      experimental: { speech_to_text_base_url: base, speech_to_text_model: "my-local-whisper" },
    }
    expect(hasCustomSpeechToTextSource(cfg)).toBe(true)
    expect(canUseSpeechToText(cfg, {})).toBe(true)
    expect(selectedSpeechToTextModel(cfg)).toBe("my-local-whisper")
  })
})
