/**
 * Extract a human-readable error message from an HTTP error response.
 * Tries to parse JSON and look for `error` or `message` fields; falls back to raw text.
 */
export function extractHttpErrorMessage(statusText: string, rawText: string): string {
  if (rawText.trim().length === 0) {
    return statusText
  }
  try {
    const errorJson = JSON.parse(rawText) as { error?: string; message?: string }
    return errorJson.error || errorJson.message || statusText
  } catch {
    return rawText
  }
}

export type SSEChunkResult = {
  content?: string
  inputTokens?: number
  outputTokens?: number
  cost?: number
}

/**
 * Parse a single SSE data line (starting with "data: ") into its structured parts.
 * Returns null for non-data lines and the [DONE] sentinel.
 */
export function parseSSEDataLine(line: string): SSEChunkResult | null {
  if (!line.startsWith("data: ")) {
    return null
  }
  const data = line.slice(6).trim()
  if (data === "[DONE]") {
    return null
  }
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      cost?: number
    }
    const result: SSEChunkResult = {}
    const content = parsed.choices?.[0]?.delta?.content
    if (content) {
      result.content = content
    }
    if (parsed.usage) {
      result.inputTokens = parsed.usage.prompt_tokens ?? 0
      result.outputTokens = parsed.usage.completion_tokens ?? 0
    }
    if (parsed.cost !== undefined) {
      result.cost = parsed.cost
    }
    return result
  } catch (err) {
    console.warn("[Kilo New] Failed to parse SSE data line", { err, line })
    return null
  }
}
