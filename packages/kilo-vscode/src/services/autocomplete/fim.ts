import type { ResponseMetaData } from "./types"
import type { AutocompleteConnection } from "./connection"
import { getAutocompleteModel, getAutocompleteModelById } from "../../shared/autocomplete-models"

const FIM_MAX_TOKENS = 256

/** The FIM model of a selection. A Next Edit model falls back to its FIM sibling where Next Edit does not apply. */
export function fimModel(provider?: string, model?: string) {
  const info = getAutocompleteModel(provider, model)
  if (info.kind !== "edit") return info
  return getAutocompleteModelById(info.fimModelID)
}

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
