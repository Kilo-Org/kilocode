import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"
import { getSpeechToTextModel } from "./models"

const PATH = "/kilo/audio/transcriptions"
const PROMPT =
  "Transcribe exactly what is spoken. Do not paraphrase, summarize, infer intent, or rewrite for clarity. Preserve the speaker's original wording as closely as possible, including incomplete phrases and unusual wording when audible."

type Req = {
  model?: string
  data: string
  format: string
  language?: string
}

type Res = {
  text?: unknown
}

type Ok = {
  ok: true
  text: string
}

type Err = {
  ok: false
  error: string
  code?: string
}

export type SpeechToTextResult = Ok | Err

export async function transcribeSpeech(
  connection: KiloConnectionService,
  input: Req,
  dir: string,
  signal?: AbortSignal,
): Promise<SpeechToTextResult> {
  const cfg = connection.getServerConfig()
  if (!cfg) return { ok: false, error: "Not connected to the Kilo backend", code: "not_connected" }

  const auth = Buffer.from(`kilo:${cfg.password}`).toString("base64")
  const url = new URL(PATH, cfg.baseUrl)
  const model = getSpeechToTextModel(input.model)
  const prompt = model.verbatim ? PROMPT : undefined
  if (dir) url.searchParams.set("directory", dir)

  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        input_audio: {
          data: input.data,
          format: input.format,
        },
        ...(input.language ? { language: input.language } : {}),
        ...(prompt ? { prompt } : {}),
      }),
    })

    const raw = await res.text()
    const body = parse(raw)

    if (!res.ok) {
      return {
        ok: false,
        error: errorMessage(body, raw) ?? `Speech to text failed with status ${res.status}`,
        code: res.status === 401 ? "not_authenticated" : undefined,
      }
    }

    const text = typeof body?.text === "string" ? body.text.trim() : ""
    if (!text) return { ok: false, error: "No speech was detected", code: "empty_transcript" }

    return { ok: true, text }
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: "Speech transcription cancelled", code: "cancelled" }
    const msg = getErrorMessage(err) || "Speech to text request failed"
    return { ok: false, error: msg, code: msg === "Failed to fetch" ? "not_available" : undefined }
  }
}

function parse(raw: string): Res | Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Res | Record<string, unknown>
  } catch {
    return null
  }
}

function errorMessage(body: Record<string, unknown> | Res | null, raw: string): string | undefined {
  if (body) {
    const obj = body as Record<string, unknown>
    const err = obj.error
    if (typeof err === "string") return err
    if (err && typeof err === "object") {
      const msg = (err as Record<string, unknown>).message
      if (typeof msg === "string") return msg
    }
    const msg = obj.message
    if (typeof msg === "string") return msg
  }
  return raw.trim() || undefined
}
