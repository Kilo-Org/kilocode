import { ResponseMetaData } from "../types"
import type { KiloConnectionService } from "../../cli-backend"
import { IAutocompleteProvider } from "../IAutocompleteProvider"

const DEFAULT_MODEL = "mistralai/codestral-2508"
const PROVIDER_DISPLAY_NAME = "Kilo Gateway"

export class KiloGatewayProvider implements IAutocompleteProvider {
  private connectionService: KiloConnectionService

  constructor(connectionService: KiloConnectionService) {
    this.connectionService = connectionService
  }

  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    const client = await this.connectionService.getClientAsync()

    let cost = 0
    let inputTokens = 0
    let outputTokens = 0

    // Capture SSE-level errors so they propagate to the caller.
    let sseError: Error | undefined
    const { stream } = await client.kilo.fim(
      {
        prefix,
        suffix,
        model: DEFAULT_MODEL,
        maxTokens: 256,
        temperature: 0.2,
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
      const content = chunk.choices?.[0]?.delta?.content
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

  public getModelName(): string {
    return DEFAULT_MODEL
  }

  public getProviderDisplayName(): string {
    return PROVIDER_DISPLAY_NAME
  }

  public hasValidCredentials(): boolean {
    return this.connectionService.getConnectionState() === "connected"
  }

  public async hasBalance(): Promise<boolean> {
    try {
      const client = await this.connectionService.getClientAsync()
      const result = await client.kilo.profile().catch(() => null)
      return (result?.data?.balance?.balance ?? 0) > 0
    } catch {
      return false
    }
  }
}
