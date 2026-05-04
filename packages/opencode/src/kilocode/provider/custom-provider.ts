// kilocode_change - new file
import type { LanguageModelV3 } from "@ai-sdk/provider"

type Model = { api: { id: string } }
type ResponsesSDK = { responses?: (id: string) => LanguageModelV3 }

export namespace CustomProviderInterface {
  export const option = "interfaceType"

  export function withoutInterface<T extends Record<string, unknown>>(input: T): Omit<T, typeof option> {
    const next = { ...input }
    delete next[option]
    return next
  }

  export function language(
    sdk: unknown,
    model: Model,
    opts: Record<string, unknown>,
  ): LanguageModelV3 | undefined {
    const api = sdk as ResponsesSDK
    if (opts[option] === "openai-responses" && typeof api.responses === "function") {
      return api.responses(model.api.id)
    }
    // Other custom provider interface types intentionally use the default
    // `sdk.languageModel()` path in the caller.
    return undefined
  }
}
