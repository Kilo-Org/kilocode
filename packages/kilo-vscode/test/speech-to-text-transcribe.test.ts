import { afterAll, describe, expect, it } from "bun:test"
import { TRANSCRIPTION_TIMEOUT_MS, transcribeSpeech } from "../src/speech-to-text/transcribe"

const seen: {
  path?: string
  auth?: string | null
  model?: string
  file?: string
  language?: string
  format?: string
  prompt?: string
} = {}

const custom = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    seen.path = url.pathname
    seen.auth = request.headers.get("authorization")
    if (url.pathname === "/denied/audio/transcriptions") return new Response("", { status: 401 })
    if (url.pathname === "/v1/audio/transcriptions") {
      const form = await request.formData()
      seen.model = String(form.get("model"))
      seen.language = String(form.get("language"))
      seen.prompt = String(form.get("prompt") ?? "")
      const file = form.get("file")
      seen.file = file instanceof Blob ? await file.text() : ""
      return Response.json({ text: "  hello there  " })
    }
    return new Response("not found", { status: 404 })
  },
})

const gateway = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    seen.path = url.pathname
    const body = (await request.json()) as { input?: Record<string, unknown> }
    const input = body.input ?? {}
    seen.model = typeof input.model === "string" ? input.model : undefined
    seen.language = typeof input.language === "string" ? input.language : undefined
    seen.prompt = typeof input.prompt === "string" ? input.prompt : undefined
    const audio = input.input_audio as { data?: string; format?: string } | undefined
    seen.file = audio?.data
    seen.format = audio?.format
    const directory = url.searchParams.get("location[directory]")
    if (directory === "/unauthorized")
      return Response.json({ type: "unauthorized", message: "Not signed in to Kilo Gateway" }, { status: 400 })
    if (directory === "/empty") return Response.json({ output: { text: "   " } })
    return Response.json({ output: { text: "  make it sticky  " } })
  },
})

afterAll(() => {
  custom.stop(true)
  gateway.stop(true)
})

const target = { url: `http://localhost:${gateway.port}`, authorization: "Basic test" }

describe("transcription timeout", () => {
  it("keeps the client budget above the Gateway server budget", () => {
    expect(TRANSCRIPTION_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000)
  })
})
const audio = { model: "openai/gpt-4o-mini-transcribe", data: Buffer.from("audio").toString("base64"), format: "m4a" }

describe("custom speech source", () => {
  it("posts audio, model, language and the verbatim prompt to the configured endpoint", async () => {
    const result = await transcribeSpeech({
      server: target,
      directory: "/repo",
      settings: { baseUrl: `http://localhost:${custom.port}/v1`, apiKey: "secret" },
      audio: { ...audio, language: "en" },
    })

    expect(seen.path).toBe("/v1/audio/transcriptions")
    expect(seen.auth).toBe("Bearer secret")
    expect(seen.model).toBe("openai/gpt-4o-mini-transcribe")
    expect(seen.language).toBe("en")
    expect(seen.prompt).toContain("Do not paraphrase")
    expect(seen.file).toBe("audio")
    expect(result).toEqual({ ok: true, text: "hello there" })
  })

  it("reports a rejected custom key without asking for a Kilo sign-in", async () => {
    const denied = `http://localhost:${custom.port}/denied`
    const result = await transcribeSpeech({
      server: target,
      directory: "/repo",
      settings: { baseUrl: denied, apiKey: "wrong" },
      audio: { data: "", format: "m4a" },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a failure")
    expect(result.code).toBeUndefined()
    expect(result.error).toBe(`Speech to text was rejected by ${denied} (HTTP 401). Check the API key for that endpoint.`)
  })
})

describe("gateway speech source", () => {
  it("transcribes through the Kilo Gateway RPC", async () => {
    const result = await transcribeSpeech({
      server: target,
      directory: "/repo",
      settings: {},
      audio: { ...audio, language: "en" },
    })

    expect(seen.path).toBe("/api/rpc/kilocode.gateway/audio.transcriptions")
    expect(seen.model).toBe("openai/gpt-4o-mini-transcribe")
    expect(seen.language).toBe("en")
    expect(seen.format).toBe("m4a")
    expect(seen.file).toBe(audio.data)
    expect(result).toEqual({ ok: true, text: "make it sticky" })
  })

  it("does not send the verbatim prompt to a model that paraphrases", async () => {
    await transcribeSpeech({
      server: target,
      directory: "/repo",
      settings: {},
      audio: { ...audio, model: "nvidia/parakeet-tdt-0.6b-v3" },
    })
    expect(seen.prompt ?? "").toBe("")
  })

  it("maps a signed-out Gateway to the sign-in flow", async () => {
    const result = await transcribeSpeech({
      server: target,
      directory: "/unauthorized",
      settings: {},
      audio,
    })
    expect(result).toEqual({ ok: false, error: "Sign in to Kilo to use speech input.", code: "not_authenticated" })
  })

  it("rejects an empty transcript", async () => {
    const result = await transcribeSpeech({
      server: target,
      directory: "/empty",
      settings: {},
      audio,
    })
    expect(result).toEqual({ ok: false, error: "No speech was detected", code: "empty_transcript" })
  })
})
