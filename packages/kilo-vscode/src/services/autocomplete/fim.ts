import { ResponseMetaData } from "./types"
import type { KiloConnectionService } from "../cli-backend"
import { getAutocompleteModel } from "../../shared/autocomplete-models"

/**
 * Generate a FIM (Fill-in-the-Middle) completion via the CLI backend.
 * Uses the SDK's kilo.fim() SSE endpoint which handles auth and streaming.
 *
 * @param signal - Optional AbortSignal to cancel the SSE stream early (e.g. when the user types again)
 */
export async function generateFim(
  connectionService: KiloConnectionService,
  modelId: string,
  prefix: string,
  suffix: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<ResponseMetaData> {
  const client = await connectionService.getClientAsync()

  let cost = 0
  let inputTokens = 0
  let outputTokens = 0

  // Capture SSE-level errors so they propagate to the caller. The SDK's SSE
  // client catches HTTP errors (402, 401, 429, 5xx) internally and silently
  // ends the stream. Without this, errors never reach ErrorBackoff.
  let sseError: Error | undefined

  const temp = getAutocompleteModel(modelId).temperature

  const { stream } = await client.kilo.fim(
    {
      prefix,
      suffix,
      model: modelId,
      maxTokens: 256,
      temperature: temp,
    },
    {
      signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error) => {
        sseError = error instanceof Error ? error : new Error(String(error))
      },
    },
  )

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const content = choice?.delta?.content ?? choice?.text
    if (content) onChunk(content)
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0
      outputTokens = chunk.usage.completion_tokens ?? 0
    }
    if (chunk.cost !== undefined) cost = chunk.cost
  }

  if (sseError) throw sseError

  return {
    cost,
    inputTokens,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  }
}

/**
 * Check if the CLI backend is connected. The CLI manages credentials internally,
 * so a connected state means we can issue FIM requests.
 */
export function hasValidCredentials(connectionService: KiloConnectionService): boolean {
  return connectionService.getConnectionState() === "connected"
}
