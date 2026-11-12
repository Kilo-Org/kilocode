import type { ResponseMetaData } from "./types"
import type { AutocompleteConnection } from "./connection"
import { getAutocompleteModelById } from "../../shared/autocomplete-models"

const FIM_MAX_TOKENS = 256

/**
 * One FIM completion through the server. The server collects the provider stream, so `onChunk` receives the whole
 * completion once. `signal` cancels the request, for example when the user types again.
 */
export async function generateFim(
  connection: AutocompleteConnection,
  modelId: string,
  prefix: string,
  suffix: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<ResponseMetaData> {
  const info = getAutocompleteModelById(modelId)
  const result = await connection.fim(
    {
      prefix,
      suffix,
      provider: info.providerID,
      model: info.modelID,
      maxTokens: FIM_MAX_TOKENS,
      temperature: info.temperature,
    },
    signal,
  )
  if (result.text) onChunk(result.text)
  return {
    cost: result.cost,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  }
}

/** The server holds the credentials, so a running server is enough to send FIM requests. */
export function hasValidCredentials(connection: AutocompleteConnection): boolean {
  return connection.connected()
}
