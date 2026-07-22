export const MAX_CLOUD_AGENT_RESPONSE_BYTES = 5 * 1024 * 1024

export class ResponseJsonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResponseJsonError"
  }
}

export async function readBoundedJson(response: Response, max = MAX_CLOUD_AGENT_RESPONSE_BYTES): Promise<unknown> {
  const length = response.headers.get("content-length")
  if (length !== null && /^\d+$/.test(length) && Number(length) > max) {
    await response.body?.cancel().catch(() => undefined)
    throw new ResponseJsonError("JSON response exceeds the configured limit")
  }
  if (response.body === null) throw new ResponseJsonError("JSON response body is missing")

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      throw new ResponseJsonError("JSON response exceeds the configured limit")
    }
    chunks.push(chunk.value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return JSON.parse(text) as unknown
  } catch {
    throw new ResponseJsonError("JSON response is invalid")
  }
}
