import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { KiloModelOptions, KiloProvider, KiloProviderOptions } from "./types.js"
import { getApiKey } from "./auth/token.js"
import { buildKiloHeaders, getDefaultHeaders } from "./headers.js"
import { ANONYMOUS_API_KEY } from "./api/constants.js"
import { resolveKiloOpenRouterBaseUrl } from "./api/url.js"
import { transformRequestBody } from "./responses.js"
import * as GatewayMetadata from "./gateway-metadata.js"

export function buildRequestHeaders(defaultHeaders: Record<string, string>, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders)
  new Headers(requestHeaders).forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}

/**
 * Create a KiloCode provider instance
 *
 * This provider wraps the OpenRouter SDK with KiloCode-specific configuration
 * including custom authentication, headers, and base URL.
 *
 * @example
 * ```typescript
 * const provider = createKilo({
 *   kilocodeToken: "your-token-here",
 *   kilocodeOrganizationId: "org-123"
 * })
 *
 * const model = provider.languageModel("anthropic/claude-sonnet-4")
 * ```
 */
export function createKilo(options: KiloProviderOptions = {}): KiloProvider {
  // Get API key from options or environment
  const apiKey = getApiKey(options)

  const openRouterUrl = resolveKiloOpenRouterBaseUrl({ baseURL: options.baseURL, token: apiKey })

  // Merge custom headers with defaults
  const customHeaders = {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: options.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }

  const originalFetch = options.fetch ?? fetch

  // Routing preferences are per model, so each transport instance is created
  // with a fetch wrapper bound to the model it serves; the wrapper also adds
  // the dynamic headers and authorization.
  function sdkOptions(model?: KiloModelOptions) {
    const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const headers = buildRequestHeaders(customHeaders, init?.headers)
      const body = transformRequestBody(input, init?.body, options.dataCollection, model?.provider)

      if (apiKey) {
        headers.set("Authorization", `Bearer ${apiKey}`)
      }

      return originalFetch(input, {
        ...init,
        headers,
        body,
      })
    }

    return {
      baseURL: openRouterUrl,
      apiKey: apiKey ?? ANONYMOUS_API_KEY,
      headers: customHeaders,
      fetch: wrappedFetch as typeof fetch,
    }
  }

  // Models without routing share the base instances; a pinned model needs its
  // own, because the preferences live in that instance's fetch wrapper.
  function routed(model: KiloModelOptions | undefined): boolean {
    return !!model?.provider && Object.keys(model.provider).length > 0
  }

  const base = sdkOptions()
  const openrouter = createOpenRouter(base)
  const anthropic = createAnthropic(base)
  const openai = createOpenAI(base)
  const openaiCompatible = createOpenAICompatible({ ...base, name: "openaiCompatible" })

  return {
    languageModel(modelId: string, model?: KiloModelOptions) {
      return routed(model) ? createOpenRouter(sdkOptions(model))(modelId) : openrouter(modelId)
    },
    embeddingModel(modelId: string) {
      return openrouter.textEmbeddingModel(modelId)
    },
    rerankingModel(modelId: string): never {
      throw new Error(`Reranking model not supported: ${modelId}`)
    },
    imageModel(modelId) {
      return openrouter.imageModel(modelId)
    },
    anthropic(modelId: string, model?: KiloModelOptions) {
      const sdk = routed(model) ? createAnthropic(sdkOptions(model)) : anthropic
      return GatewayMetadata.wrap(sdk(modelId))
    },
    openai(modelId: string, model?: KiloModelOptions) {
      const sdk = routed(model) ? createOpenAI(sdkOptions(model)) : openai
      return GatewayMetadata.wrap(sdk(modelId))
    },
    openaiCompatible(modelId: string, model?: KiloModelOptions) {
      const sdk = routed(model)
        ? createOpenAICompatible({ ...sdkOptions(model), name: "openaiCompatible" })
        : openaiCompatible
      return sdk(modelId)
    },
  }
}
