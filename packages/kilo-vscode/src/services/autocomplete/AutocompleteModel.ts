import { ResponseMetaData } from "./types"
import type { KiloConnectionService } from "../cli-backend"

const DEFAULT_MODEL = "mistralai/codestral-2508"
const PROVIDER_DISPLAY_NAME = "Kilo Gateway"

/** Chunk from an LLM streaming response */
export type ApiStreamChunk =
  | { type: "text"; text: string }
  | {
      type: "usage"
      totalCost?: number
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }

export class AutocompleteModel {
  private connectionService: KiloConnectionService | null = null
  public profileName: string | null = null
  public profileType: string | null = null

  constructor(connectionService?: KiloConnectionService) {
    if (connectionService) {
      this.connectionService = connectionService
    }
  }

  /**
   * Set the connection service (can be called after construction when service becomes available)
   */
  public setConnectionService(service: KiloConnectionService): void {
    this.connectionService = service
  }

  public supportsFim(): boolean {
    return true
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

  /**
   * Generate response via chat completions (holefiller fallback).
   * Not used when FIM is supported, but kept for compatibility.
   */
  public async generateResponse(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: ApiStreamChunk) => void,
  ): Promise<ResponseMetaData> {
    // FIM is the primary strategy; this method is a fallback.
    // For now, throw — callers should use generateFimResponse via supportsFim().
    throw new Error("Chat-based completions are not supported via CLI backend. Use FIM (supportsFim() returns true).")
  }

  public getModelName(): string {
    return DEFAULT_MODEL
  }

  public getProviderDisplayName(): string {
    return PROVIDER_DISPLAY_NAME
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
