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
  public loaded = false
  public hasKilocodeProfileWithNoBalance = false

  constructor(connectionService?: KiloConnectionService) {
    if (connectionService) {
      this.connectionService = connectionService
      this.loaded = true
    }
  }

  /**
   * Set the connection service (can be called after construction when service becomes available)
   */
  public setConnectionService(service: KiloConnectionService): void {
    this.connectionService = service
  }

  /**
   * Load model configuration.
   * Returns true if the connection service is available.
   */
  public async reload(): Promise<boolean> {
    this.loaded = true

    if (this.connectionService) {
      const state = this.connectionService.getConnectionState()
      return state === "connected"
    }

    return false
  }

  public supportsFim(): boolean {
    return true
  }

  /**
   * Generate a FIM (Fill-in-the-Middle) completion via the CLI backend.
   * The CLI backend handles auth using the stored kilo OAuth token.
   */
  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    _taskId?: string,
  ): Promise<ResponseMetaData> {
    if (!this.connectionService) {
      throw new Error("Connection service is not available")
    }

    const state = this.connectionService.getConnectionState()
    if (state !== "connected") {
      throw new Error(`CLI backend is not connected (state: ${state})`)
    }

    const client = this.connectionService.getHttpClient()

    const result = await client.fimCompletion(prefix, suffix, onChunk, {
      model: DEFAULT_MODEL,
      maxTokens: 256,
      temperature: 0.2,
    })

    return {
      cost: result.cost,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
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
}
