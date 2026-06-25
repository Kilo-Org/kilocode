import { createAlibaba } from "@ai-sdk/alibaba"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createMistral } from "@ai-sdk/mistral"
import type { KiloProvider, KiloProviderOptions } from "./types.js"
import { getApiKey } from "./auth/token.js"
import { buildKiloHeaders, getDefaultHeaders } from "./headers.js"
import { ANONYMOUS_API_KEY } from "./api/constants.js"
import { resolveKiloOpenRouterBaseUrl } from "./api/url.js"
import { transformRequestBody } from "./responses.js"

export function buildRequestHeaders(defaultHeaders: Record<string, string>, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders)
  new Headers(requestHeaders).forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}

/**
 * Create a Relay provider instance.
 *
 * Wraps the OpenAI-compatible SDK pointed at the Relay LiteLLM gateway
 * (local Docker, Relay Cloud on Railway, or self-hosted in the customer's
 * VPC). LiteLLM internally routes by `model_name`, so the per-provider
 * accessors (anthropic/openai/mistral/alibaba) all dispatch through the
 * same gateway URL.
 *
 * The function is still named `createKilo` and returns a `KiloProvider`
 * shape to keep the rest of the fork compiling without a wide refactor.
 * Rename is tracked separately for the cosmetic pass (task #21).
 *
 * @example
 * ```ts
 * const provider = createKilo({
 *   kilocodeToken: "sk-relay-...", // Relay virtual key
 *   baseURL: "https://gateway.relay.dev/v1",
 * })
 * const model = provider.languageModel("primary") // → LiteLLM routes per config.yaml
 * ```
 */
export function createKilo(options: KiloProviderOptions = {}): KiloProvider {
  // Get API key from options or environment.
  // For Relay this is the user's BYOK provider key (passed via x-provider-key
  // header by the extension) OR a Relay virtual key for the hosted gateway.
  const apiKey = getApiKey(options)

  // resolveKiloOpenRouterBaseUrl returns ${KILO_API_BASE}/v1 by default now.
  const gatewayUrl = resolveKiloOpenRouterBaseUrl({ baseURL: options.baseURL, token: apiKey })

  // Merge custom headers with defaults.
  const customHeaders = {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: options.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }

  // Custom fetch wrapper: re-apply headers and let transformRequestBody
  // strip "responses"-API metadata that LiteLLM doesn't accept.
  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = buildRequestHeaders(customHeaders, init?.headers)
    const body = transformRequestBody(input, init?.body, options.dataCollection)

    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`)
    }

    return originalFetch(input, {
      ...init,
      headers,
      body,
    })
  }

  const sdkOptions = {
    baseURL: gatewayUrl,
    apiKey: apiKey ?? ANONYMOUS_API_KEY,
    headers: customHeaders,
    fetch: wrappedFetch as typeof fetch,
  }

  // Primary path: OpenAI-compatible (LiteLLM's native protocol).
  const openaiCompatible = createOpenAICompatible({ ...sdkOptions, name: "relay" })

  // Per-provider SDKs still work because LiteLLM accepts the native wire
  // formats too — useful for callers that need provider-specific options.
  // All four point at the same gateway URL.
  const alibaba = createAlibaba(sdkOptions)
  const anthropic = createAnthropic(sdkOptions)
  const openai = createOpenAI(sdkOptions)
  const mistral = createMistral(sdkOptions)

  return {
    languageModel(modelId) {
      return openaiCompatible(modelId)
    },
    embeddingModel(modelId: string) {
      return openaiCompatible.textEmbeddingModel(modelId)
    },
    rerankingModel(modelId: string): never {
      throw new Error(`Reranking model not supported: ${modelId}`)
    },
    imageModel(_modelId) {
      // LiteLLM gateway doesn't proxy image generation in MVP. Throw eagerly
      // so callers get a clear error instead of a network failure at request
      // time.
      throw new Error("Image generation is not supported through the Relay gateway in MVP.")
    },
    alibaba(modelId) {
      return alibaba(modelId)
    },
    anthropic(modelId) {
      return anthropic(modelId)
    },
    mistral(modelId) {
      return mistral(modelId)
    },
    openai(modelId) {
      return openai(modelId)
    },
    openaiCompatible(modelId) {
      return openaiCompatible(modelId)
    },
  }
}
