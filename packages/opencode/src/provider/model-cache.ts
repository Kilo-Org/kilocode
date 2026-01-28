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

    // Other providers not implemented yet
    log.debug("provider not implemented", { providerID })
    return {}
  }

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

      if (providerConfig?.options?.kilocodeOrganizationId) {
        options.kilocodeOrganizationId = providerConfig.options.kilocodeOrganizationId
      }

      // Get from Auth
      const auth = await Auth.get(providerID)
      if (auth) {
        if (auth.type === "api") {
          options.kilocodeToken = auth.key
        } else if (auth.type === "oauth") {
          options.kilocodeToken = auth.access
        }
      }

      // Get from Env
      const env = Env.all()
      if (env.KILOCODE_TOKEN) {
        options.kilocodeToken = env.KILOCODE_TOKEN
      }
      if (env.KILOCODE_ORGANIZATION_ID) {
        options.kilocodeOrganizationId = env.KILOCODE_ORGANIZATION_ID
      }

      log.debug("auth options resolved", {
        providerID,
        hasToken: !!options.kilocodeToken,
        hasOrganizationId: !!options.kilocodeOrganizationId,
      })
    }

    return options
  }
}
