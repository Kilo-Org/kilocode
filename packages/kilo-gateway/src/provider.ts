import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { KiloProvider, KiloProviderOptions } from "./types.js"
import { getApiKey } from "./auth/token.js"
import { buildKiloHeaders, getDefaultHeaders } from "./headers.js"
import { ANONYMOUS_API_KEY, DEFAULT_KILO_API_URL } from "./api/constants.js"
import { resolveKiloOpenRouterBaseUrl } from "./api/url.js"
import { transformRequestBody } from "./responses.js"
import * as GatewayMetadata from "./gateway-metadata.js"
import { promisify } from "node:util"
import * as zlib from "node:zlib"

const compress = typeof zlib.zstdCompress === "function" ? promisify(zlib.zstdCompress) : undefined

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
  const compression = options.requestCompression ?? new URL(openRouterUrl).origin === DEFAULT_KILO_API_URL

  // Merge custom headers with defaults
  const customHeaders = {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: options.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }

  // Create custom fetch wrapper to add dynamic headers
  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = buildRequestHeaders(customHeaders, init?.headers)
    const body = transformRequestBody(input, init?.body, options.dataCollection)

    // Add authorization if API key exists
    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`)
    }

    const payload = await (async () => {
      if (!compression || !compress || typeof body !== "string" || headers.has("content-encoding")) return body
      const size = Buffer.byteLength(body)
      if (size < 64 * 1024) return body
      init?.signal?.throwIfAborted()
      const encoded = await compress(body, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
      init?.signal?.throwIfAborted()
      if (encoded.byteLength >= size) return body
      headers.set("content-encoding", "zstd")
      headers.delete("content-length")
      return new Uint8Array(encoded)
    })()

    return originalFetch(input, {
      ...init,
      headers,
      body: payload,
    })
  }

  const sdkOptions = {
    baseURL: openRouterUrl,
    apiKey: apiKey ?? ANONYMOUS_API_KEY,
    headers: customHeaders,
    fetch: wrappedFetch as typeof fetch,
  }

  const openrouter = createOpenRouter(sdkOptions)
  const anthropic = createAnthropic(sdkOptions)
  const openai = createOpenAI(sdkOptions)
  const openaiCompatible = createOpenAICompatible({ ...sdkOptions, name: "openaiCompatible" })

  return {
    languageModel(modelId) {
      return openrouter(modelId)
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
    anthropic(modelId) {
      return GatewayMetadata.wrap(anthropic(modelId))
    },
    openai(modelId) {
      return GatewayMetadata.wrap(openai(modelId))
    },
    openaiCompatible(modelId) {
      return openaiCompatible(modelId)
    },
  }
}
