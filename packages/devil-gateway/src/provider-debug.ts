import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { DevilProvider, DevilProviderOptions } from "./types.js"
import { getDevilUrlFromToken, getApiKey } from "./auth/token.js"
import { buildDevilHeaders, getDefaultHeaders } from "./headers.js"
import { DEVIL_API_BASE, ANONYMOUS_API_KEY } from "./api/constants.js"

/**
 * Debug version of createDevil with extensive logging
 */
export function createDevilDebug(options: DevilProviderOptions = {}): DevilProvider {
  console.log("\n🔍 [KILO DEBUG] Creating Devil Provider")
  console.log("📋 [KILO DEBUG] Options received:", JSON.stringify(options, null, 2))

  // Get API key from options or environment
  const apiKey = getApiKey(options)
  console.log("🔑 [KILO DEBUG] API Key extracted:")
  console.log("  - Source:", options.devilcodeToken ? "devilcodeToken" : options.apiKey ? "apiKey" : "none")
  console.log("  - Value:", apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 8)}` : "MISSING!")

  // Determine base URL
  const baseApiUrl = getDevilUrlFromToken(options.baseURL ?? DEVIL_API_BASE, apiKey ?? "")
  console.log("🌐 [KILO DEBUG] Base URL resolved:", baseApiUrl)

  // Build OpenRouter URL - only append /openrouter/ if not already present
  const openRouterUrl = baseApiUrl.includes("/openrouter")
    ? baseApiUrl
    : baseApiUrl.endsWith("/")
      ? `${baseApiUrl}openrouter/`
      : `${baseApiUrl}/openrouter/`
  console.log("🔗 [KILO DEBUG] OpenRouter URL:", openRouterUrl)

  // Merge custom headers with defaults
  const customHeaders = {
    ...getDefaultHeaders(),
    ...buildDevilHeaders(undefined, {
      devilcodeOrganizationId: options.devilcodeOrganizationId,
      devilcodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }
  console.log("📝 [KILO DEBUG] Custom headers:", JSON.stringify(customHeaders, null, 2))

  // Create custom fetch wrapper to add dynamic headers
  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    console.log("\n🚀 [KILO DEBUG] Making request:")
    console.log("  - URL:", String(input))
    console.log("  - Method:", init?.method || "GET")

    const headers = new Headers(init?.headers)

    // Add custom headers
    Object.entries(customHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })

    // Add authorization if API key exists
    if (apiKey) {
      const authValue = `Bearer ${apiKey}`
      headers.set("Authorization", authValue)
      console.log(
        "  - Authorization header set:",
        `Bearer ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 8)}`,
      )
    } else {
      console.log("  ⚠️ - NO AUTHORIZATION HEADER! API key is missing")
    }

    console.log("  - Headers being sent:")
    headers.forEach((value, key) => {
      if (key.toLowerCase() === "authorization") {
        console.log(`    ${key}: ${value.substring(0, 20)}...`)
      } else {
        console.log(`    ${key}: ${value}`)
      }
    })

    const response = await originalFetch(input, {
      ...init,
      headers,
    })

    console.log("  - Response status:", response.status, response.statusText)

    if (!response.ok) {
      const responseText = await response.text()
      console.log("  ❌ - Error response:", responseText)
      // Re-create response since we consumed the body
      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    return response
  }

  console.log("✅ [KILO DEBUG] Creating provider with configuration\n")

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
    languageModel(modelId: string) {
      return openrouter(modelId)
    },
    embeddingModel(modelId: string) {
      return openrouter.textEmbeddingModel(modelId)
    },
    textEmbeddingModel(modelId: string) {
      return openrouter.textEmbeddingModel(modelId)
    },
    rerankingModel(modelId: string): never {
      throw new Error(`Reranking model not supported: ${modelId}`)
    },
    imageModel(modelId: string) {
      return openrouter.imageModel(modelId)
    },
    anthropic(modelId: string) {
      return anthropic(modelId)
    },
    openai(modelId: string) {
      return openai(modelId)
    },
    openaiCompatible(modelId: string) {
      return openaiCompatible(modelId)
    },
  }
}
