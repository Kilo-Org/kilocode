import { ResponseMetaData } from "./types"

export interface IAutocompleteProvider {
  /**
   * Generates a FIM (Fill-in-the-Middle) completion
   */
  generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData>

  getModelName(): string
  getProviderDisplayName(): string
  hasValidCredentials(): boolean
  hasBalance(): Promise<boolean>
}
