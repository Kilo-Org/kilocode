import { ResponseMetaData } from "./types"
import type { KiloConnectionService } from "../cli-backend"
import { IAutocompleteProvider } from "./IAutocompleteProvider"
import { KiloGatewayProvider } from "./providers/KiloGatewayProvider"
import { CustomProvider } from "./providers/CustomProvider"

const DEFAULT_MODEL = "mistralai/codestral-2508"
const PROVIDER_DISPLAY_NAME = "Kilo Gateway"

export class AutocompleteModel implements IAutocompleteProvider {
  private connectionService: KiloConnectionService | null = null
  public profileName: string | null = null
  public profileType: string | null = null

  private activeProvider: IAutocompleteProvider | null = null

  constructor(connectionService?: KiloConnectionService) {
    if (connectionService) {
      this.setConnectionService(connectionService)
    }
  }

  /**
   * Set the connection service (can be called after construction when service becomes available)
   */
  public setConnectionService(service: KiloConnectionService): void {
    this.connectionService = service
    this.activeProvider = new KiloGatewayProvider(service)
  }

  /**
   * Resolve which provider to use based on the CLI config.
   * Called only by refreshConfig() — the result is cached in activeProvider.
   */
  private async resolveProvider(): Promise<IAutocompleteProvider> {
    if (!this.connectionService) {
      throw new Error("Connection service is not available")
    }

    try {
      const client = await this.connectionService.getClientAsync()
      const { data: config } = await client.config.get()

      const autocomplete = config?.autocomplete
      if (autocomplete?.provider && autocomplete?.api) {
        return new CustomProvider(
          autocomplete.provider,
          autocomplete.model || DEFAULT_MODEL,
          autocomplete.api,
          autocomplete.options?.apiKey
        )
      }
    } catch (err) {
      console.warn("[autocomplete] Failed to resolve provider from config, using default", err)
    }

    return new KiloGatewayProvider(this.connectionService)
  }

  /**
   * Fetch the latest config and cache the resolved provider.
   * Should be called on load() and when CLI state changes.
   */
  public async refreshConfig(): Promise<void> {
    this.activeProvider = await this.resolveProvider()
  }

  /**
   * Returns the cached provider, falling back to KiloGateway if none resolved yet.
   */
  private getProvider(): IAutocompleteProvider {
    if (!this.activeProvider && this.connectionService) {
      this.activeProvider = new KiloGatewayProvider(this.connectionService)
    }
    if (!this.activeProvider) {
      throw new Error("Connection service is not available")
    }
    return this.activeProvider
  }

  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    return this.getProvider().generateFimResponse(prefix, suffix, onChunk, signal)
  }

  public getModelName(): string {
    return this.activeProvider?.getModelName() ?? DEFAULT_MODEL
  }

  public getProviderDisplayName(): string {
    return this.activeProvider?.getProviderDisplayName() ?? PROVIDER_DISPLAY_NAME
  }

  public hasValidCredentials(): boolean {
    if (!this.activeProvider) return false
    return this.activeProvider.hasValidCredentials()
  }

  public async hasBalance(): Promise<boolean> {
    if (!this.activeProvider) return false
    try {
      return await this.activeProvider.hasBalance()
    } catch {
      return false
    }
  }
}
