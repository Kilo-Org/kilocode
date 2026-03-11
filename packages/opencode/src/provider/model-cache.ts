// kilocode_change new file
import { fetchKiloModels } from "@kilocode/kilo-gateway"
import { Config } from "../config/config"
import { Auth } from "../auth"
import { Env } from "../env"
import { Log } from "../util/log"

export namespace ModelCache {
  const log = Log.create({ service: "model-cache" })

  // Cache structure
  const cache = new Map<
    string,
    {
      models: Record<string, any>
      timestamp: number
    }
  >()

  const TTL = 5 * 60 * 1000 // 5 minutes
  const inFlightRefresh = new Map<string, Promise<Record<string, any>>>()

  /**
   * Get cached models if available and not expired
   * @param providerID - Provider identifier (e.g., "kilo")
   * @returns Cached models or undefined if cache miss or expired
   */
  export function get(providerID: string): Record<string, any> | undefined {
    const cached = cache.get(providerID)

    if (!cached) {
      log.debug("cache miss", { providerID })
      return undefined
    }

    const now = Date.now()
    const age = now - cached.timestamp

    if (age > TTL) {
      log.debug("cache expired", { providerID, age })
      cache.delete(providerID)
      return undefined
    }

    log.debug("cache hit", { providerID, age })
    return cached.models
  }

  /**
   * Fetch models with cache-first approach
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Models from cache or freshly fetched
   */
  export async function fetch(providerID: string, options?: any): Promise<Record<string, any>> {
    // Check cache first
    const cached = get(providerID)
    if (cached) {
      return cached
    }

    // Cache miss - fetch models
    log.info("fetching models", { providerID })

    try {
      const authOptions = await getAuthOptions(providerID)
      const mergedOptions = { ...authOptions, ...options }

      const models = await fetchModels(providerID, mergedOptions)

      // Store in cache
      cache.set(providerID, {
        models,
        timestamp: Date.now(),
      })

      log.info("models fetched and cached", { providerID, count: Object.keys(models).length })
      return models
    } catch (error) {
      log.error("failed to fetch models", { providerID, error })
      return {}
    }
  }

  /**
   * Force refresh models (bypass cache)
   * Uses atomic refresh pattern to prevent race conditions
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Freshly fetched models
   */
  export async function refresh(providerID: string, options?: any): Promise<Record<string, any>> {
    // Check if refresh already in progress
    const existing = inFlightRefresh.get(providerID)
    if (existing) {
      log.debug("refresh already in progress, returning existing promise", { providerID })
      return existing
    }

    // Create new refresh promise
    const refreshPromise = (async () => {
      log.info("refreshing models", { providerID })

      try {
        const authOptions = await getAuthOptions(providerID)
        const mergedOptions = { ...authOptions, ...options }

        const models = await fetchModels(providerID, mergedOptions)

        // Update cache with new models
        cache.set(providerID, {
          models,
          timestamp: Date.now(),
        })

        log.info("models refreshed", { providerID, count: Object.keys(models).length })
        return models
      } catch (error) {
        log.error("failed to refresh models", { providerID, error })

        // Return existing cache or empty object
        const cached = cache.get(providerID)
        if (cached) {
          log.debug("returning stale cache after refresh failure", { providerID })
          return cached.models
        }

        return {}
      }
    })()

    // Track in-flight refresh
    inFlightRefresh.set(providerID, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      // Clean up in-flight tracking
      inFlightRefresh.delete(providerID)
    }
  }

  /**
   * Clear cached models for a provider
   * @param providerID - Provider identifier
   */
  export function clear(providerID: string): void {
    const deleted = cache.delete(providerID)
    if (deleted) {
      log.info("cache cleared", { providerID })
    } else {
      log.debug("no cache to clear", { providerID })
    }
  }

  /**
   * Fetch models based on provider type
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Fetched models
   */
  async function fetchModels(providerID: string, options: any): Promise<Record<string, any>> {
    if (providerID === "kilo") {
      return fetchKiloModels(options)
    }

    // kilocode_change start
    if (providerID === "oca") {
      return fetchOcaModels(options)
    }
    // kilocode_change end

    // Other providers not implemented yet
    log.debug("provider not implemented", { providerID })
    return {}
  }

  // kilocode_change start
  const DEFAULT_OCA_BASE_URL = "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com"

  async function fetchOcaModels(options: any): Promise<Record<string, any>> {
    const baseUrl = options?.baseUrl ?? process.env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
    const token = options?.accessToken

    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/model/info`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      client: "kilo",
      "client-version": "1.0.0",
    }
    if (token) headers["Authorization"] = `Bearer ${token}`

    const response = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`OCA model fetch failed: ${response.status} ${response.statusText}`)
    }

    const json = (await response.json()) as { data?: any[] }
    const dataArray: any[] = Array.isArray(json?.data) ? json.data : []
    const models: Record<string, any> = {}

    for (const model of dataArray) {
      const modelId = model?.litellm_params?.model
      if (typeof modelId !== "string" || !modelId) continue

      const supportedApis: string[] = Array.isArray(model?.model_info?.supported_api_list)
        ? model.model_info.supported_api_list
        : []
      if (!supportedApis.includes("CHAT_COMPLETIONS") && !supportedApis.includes("RESPONSES")) continue

      const info = model?.model_info || {}
      const maxTokens = typeof model?.litellm_params?.max_tokens === "number" ? model.litellm_params.max_tokens : -1
      const contextWindow =
        typeof info?.context_window === "number" && info.context_window > 0 ? info.context_window : 128000

      const apiType = supportedApis.includes("RESPONSES")
        ? "responses"
        : supportedApis.includes("CHAT_COMPLETIONS")
          ? "chat-completions"
          : "unknown"

      models[modelId] = {
        id: modelId,
        name: modelId,
        family: "",
        release_date: "",
        attachment: !!info?.supports_vision,
        reasoning: !!info?.is_reasoning_model,
        temperature: true,
        tool_call: true,
        cost: {
          input: info?.input_price !== undefined ? parseFloat(info.input_price) * 1_000_000 : 0,
          output: info?.output_price !== undefined ? parseFloat(info.output_price) * 1_000_000 : 0,
          cache_read: info?.cached_price !== undefined ? parseFloat(info.cached_price) * 1_000_000 : 0,
          cache_write: info?.caching_price !== undefined ? parseFloat(info.caching_price) * 1_000_000 : 0,
        },
        limit: {
          context: contextWindow,
          output: maxTokens > 0 ? maxTokens : 4096,
        },
        modalities: {
          input: ["text", ...(info?.supports_vision ? ["image"] : [])],
          output: ["text"],
        },
        options: {
          apiType,
          supportedApiTypes: supportedApis.filter((a: string) => a === "CHAT_COMPLETIONS" || a === "RESPONSES"),
        },
      }
    }

    return models
  }
  // kilocode_change end

  /**
   * Get authentication options from multiple sources
   * Priority: Config > Auth > Env
   * @param providerID - Provider identifier
   * @returns Options object with authentication credentials
   */
  async function getAuthOptions(providerID: string): Promise<any> {
    const options: any = {}

    if (providerID === "kilo") {
      // Get from Config
      const config = await Config.get()
      const providerConfig = config.provider?.[providerID]
      if (providerConfig?.options?.apiKey) {
        options.kilocodeToken = providerConfig.options.apiKey
      }

      // kilocode_change start
      if (providerConfig?.options?.kilocodeOrganizationId) {
        options.kilocodeOrganizationId = providerConfig.options.kilocodeOrganizationId
      }
      // kilocode_change end

      // Get from Auth
      const auth = await Auth.get(providerID)
      if (auth) {
        if (auth.type === "api") {
          options.kilocodeToken = auth.key
        } else if (auth.type === "oauth") {
          options.kilocodeToken = auth.access
          // kilocode_change start - read org ID from OAuth accountId for enterprise model filtering
          if (auth.accountId) {
            options.kilocodeOrganizationId = auth.accountId
          }
          // kilocode_change end
        }
      }

      // Get from Env
      const env = Env.all()
      if (env.KILO_API_KEY) {
        options.kilocodeToken = env.KILO_API_KEY
      }
      if (env.KILO_ORG_ID) {
        options.kilocodeOrganizationId = env.KILO_ORG_ID
      }

      log.debug("auth options resolved", {
        providerID,
        hasToken: !!options.kilocodeToken,
        hasOrganizationId: !!options.kilocodeOrganizationId,
      })
    }

    // kilocode_change start
    if (providerID === "oca") {
      const auth = await Auth.get(providerID)
      if (auth?.type === "oauth") {
        options.accessToken = auth.access
      }
      const config = await Config.get()
      const providerConfig = config.provider?.[providerID]
      if (providerConfig?.options?.baseURL) {
        options.baseUrl = providerConfig.options.baseURL
      }
    }
    // kilocode_change end

    return options
  }
}
