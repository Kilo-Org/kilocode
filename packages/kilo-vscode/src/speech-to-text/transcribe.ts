import type { Target } from "../relay"
import { getSpeechToTextModel } from "./models"
import { SpeechRpcError, callSpeechRpc } from "./rpc"
import { hasCustomSource, sourceHeaders, sourceUrl, VERBATIM_PROMPT, type SpeechToTextSettings } from "./source"

// Keep the client budget above the Gateway's 120 s so the server's own timeout reports the failure.
export const TRANSCRIPTION_TIMEOUT_MS = 130_000

type Audio = {
  model?: string
  data: string
  format: string
  language?: string
}

type Ok = { ok: true; text: string }
type Err = { ok: false; error: string; code?: string }

export type SpeechTranscriptionResult = Ok | Err

export async function transcribeSpeech(input: {
  server: Target
  directory: string
  settings: SpeechToTextSettings
  audio: Audio
  signal?: AbortSignal
}): Promise<SpeechTranscriptionResult> {
  const source = input.settings.baseUrl
    ? { baseUrl: input.settings.baseUrl.replace(/\/+$/, ""), apiKey: input.settings.apiKey }
    : undefined
  if (hasCustomSource(source)) return await transcribeWithSource(source, input.audio, input.signal)
  return await transcribeWithGateway(input)
}

async function transcribeWithGateway(input: {
  server: Target
  directory: string
  audio: Audio
  signal?: AbortSignal
}): Promise<SpeechTranscriptionResult> {
  const model = getSpeechToTextModel(input.audio.model)
  const prompt = model.verbatim ? VERBATIM_PROMPT : undefined
  try {
    const output = await callSpeechRpc({
      server: input.server,
      directory: input.directory,
      method: "audio.transcriptions",
      body: {
        model: input.audio.model || model.id,
        input_audio: { data: input.audio.data, format: input.audio.format },
        ...(input.audio.language ? { language: input.audio.language } : {}),
        ...(prompt ? { prompt } : {}),
      },
      signal: input.signal,
      timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
    })
    return transcript(output)
  } catch (err) {
    if (input.signal?.aborted) return { ok: false, error: "Speech transcription cancelled", code: "cancelled" }
    if (err instanceof SpeechRpcError && err.code === "unauthorized")
      return { ok: false, error: "Sign in to Kilo to use speech input.", code: "not_authenticated" }
    return { ok: false, error: message(err), code: "not_available" }
  }
}

async function transcribeWithSource(
  source: { baseUrl: string; apiKey?: string },
  audio: Audio,
  cancel?: AbortSignal,
): Promise<SpeechTranscriptionResult> {
  const timeout = AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout
  const model = getSpeechToTextModel(audio.model)
  const prompt = model.verbatim ? VERBATIM_PROMPT : undefined
  const form = new FormData()
  form.set("file", new Blob([new Uint8Array(Buffer.from(audio.data, "base64"))]), `speech.${audio.format}`)
  form.set("model", audio.model || model.id)
  form.set("response_format", "json")
  if (audio.language) form.set("language", audio.language)
  if (prompt) form.set("prompt", prompt)

  try {
    const response = await fetch(sourceUrl(source, "audio/transcriptions"), {
      method: "POST",
      signal,
      headers: sourceHeaders(source),
      body: form,
    })
    const raw = await response.text()
    const body = parse(raw)
    if (!response.ok) return { ok: false, error: errorMessage(body, raw, response.status, source.baseUrl) }
    return transcript(body)
  } catch (err) {
    if (cancel?.aborted) return { ok: false, error: "Speech transcription cancelled", code: "cancelled" }
    return { ok: false, error: message(err), code: "not_available" }
  }
}

function transcript(body: unknown): SpeechTranscriptionResult {
  const text =
    body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : ""
  if (!text) return { ok: false, error: "No speech was detected", code: "empty_transcript" }
  return { ok: true, text }
}

function parse(raw: string): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function errorMessage(body: unknown, raw: string, status: number, baseUrl: string): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error
    if (typeof error === "string") return error
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string")
      return (error as { message: string }).message
    const message = (body as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  if (status === 401 || status === 403)
    return `Speech to text was rejected by ${baseUrl} (HTTP ${status}). Check the API key for that endpoint.`
  return raw.trim() || `Speech to text failed at ${baseUrl} with status ${status}`
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
