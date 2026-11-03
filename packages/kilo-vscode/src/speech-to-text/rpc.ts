// Calls a Kilo plugin RPC from the extension host. The host knows the server credentials and the webview does not,
// so speech capture, catalog and transcription run here and the audio bytes never cross a webview message.
import { local } from "../local"
import type { Target } from "../relay"

const ID = "kilocode.gateway"
const DEFAULT_TIMEOUT_MS = 15_000

export class SpeechRpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export async function callSpeechRpc(input: {
  server: Target
  directory: string
  method: string
  body: unknown
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<unknown> {
  const query = new URLSearchParams({ "location[directory]": input.directory })
  const timeout = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const response = await local(new URL(`/api/rpc/${ID}/${input.method}?${query}`, input.server.url), {
    method: "POST",
    headers: { authorization: input.server.authorization, "content-type": "application/json" },
    body: JSON.stringify({ input: input.body }),
    signal,
  })
  const text = await response.text()
  const body = parse(text)
  if (!response.ok) throw new SpeechRpcError(errorMessage(body, text, response.status), errorCode(body))
  if (!body || typeof body !== "object" || !("output" in body)) return undefined
  return (body as { output?: unknown }).output
}

function parse(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const type = (body as { type?: unknown }).type
  return typeof type === "string" ? type : undefined
}

function errorMessage(body: unknown, text: string, status: number): string {
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return text.trim() || `Request failed with status ${status}`
}
