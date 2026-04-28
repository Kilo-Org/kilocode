import { ResponseMetaData } from "./types"
import type { KiloConnectionService } from "../cli-backend"
import { DEFAULT_AUTOCOMPLETE_MODEL, getAutocompleteModel } from "../../shared/autocomplete-models"

export class AutocompleteModel {
  private connectionService: KiloConnectionService | null = null
  private currentModel: string = DEFAULT_AUTOCOMPLETE_MODEL.id
  public profileName: string | null = null
  public profileType: string | null = null

  constructor(connectionService?: KiloConnectionService) {
    if (connectionService) {
      this.connectionService = connectionService
    }
  }

  public setModel(model: string): void {
    this.currentModel = model
  }

  /**
   * Set the connection service (can be called after construction when service becomes available)
   */
  public setConnectionService(service: KiloConnectionService): void {
    this.connectionService = service
  }

  /**
   * Generate a FIM (Fill-in-the-Middle) completion via the CLI backend.
   * Uses the SDK's kilo.fim() SSE endpoint which handles auth and streaming.
   *
   * @param signal - Optional AbortSignal to cancel the SSE stream early (e.g. when the user types again)
   */
  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    if (!this.connectionService) {
      throw new Error("Connection service is not available")
    }

    const client = await this.connectionService.getClientAsync()

    let cost = 0
    let inputTokens = 0
    let outputTokens = 0

    // Capture SSE-level errors so they propagate to the caller. The SDK's SSE
    // client catches HTTP errors (402, 401, 429, 5xx) internally and silently
    // ends the stream. Without this, errors never reach ErrorBackoff.
    let sseError: Error | undefined

    const temp = getAutocompleteModel(this.currentModel).temperature

    const { stream } = await client.kilo.fim(
      {
        prefix,
        suffix,
        model: this.currentModel,
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

  public getModelName(): string {
    return this.currentModel
  }

  public getProviderDisplayName(): string {
    return getAutocompleteModel(this.currentModel).provider
  }

  /**
   * Check if the model has valid credentials.
   * With CLI backend, credentials are managed by the backend — we just need a connection.
   */
  public hasValidCredentials(): boolean {
    if (!this.connectionService) {
      return false
    }
    return this.connectionService.getConnectionState() === "connected"
  }

  /**
   * Check the user's credit balance via the profile endpoint.
   * Returns true if the user has a positive balance, false otherwise.
   * Returns false on any error (not connected, fetch failed, etc.).
   */
  public async hasBalance(): Promise<boolean> {
    if (!this.connectionService) return false
    try {
      const client = await this.connectionService.getClientAsync()
      const result = await client.kilo.profile().catch(() => null)
      return (result?.data?.balance?.balance ?? 0) > 0
    } catch {
      return false
    }
  }
}
