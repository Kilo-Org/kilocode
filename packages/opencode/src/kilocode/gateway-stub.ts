/**
 * Stub implementations for @kilocode/kilo-gateway functions.
 *
 * In Bedrock-only mode, these functions throw explicit errors.
 * In normal mode, they delegate to the real gateway functions via lazy imports.
 */

import { isBedrockOnlyEnabled } from "./enterprise"

function bedrockOnlyError(fn: string): never {
  throw new Error(
    `${fn} is disabled in enterprise Bedrock-only mode. ` +
      "Only AWS Bedrock endpoints are allowed. No Kilo Gateway calls are permitted.",
  )
}

function gatewayFn(name: string): (...args: any[]) => Promise<any> {
  return async function (...args: any[]) {
    if (isBedrockOnlyEnabled()) {
      if (name === "fetchOrganizationModes" || name === "fetchKilocodeNotifications") return []
      if (name === "clearModesCache" || name === "migrateLegacyKiloAuth") return
      if (name === "buildKiloHeaders") return {}
      bedrockOnlyError(name)
    }
    const mod = await import("@kilocode/kilo-gateway")
    const fn = (mod as any)[name]
    if (typeof fn !== "function") throw new Error(`Gateway function ${name} not found`)
    return fn(...args)
  }
}

// Re-export constants locally
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"
export const HEADER_ORGANIZATIONID = "X-KILOCODE-ORGANIZATIONID"
export const KILO_API_BASE = "https://api.kilo.ai"
export const KILO_CHAT_URL = "https://chat.kiloapps.io"
export const KILO_EVENT_SERVICE_URL = "wss://events.kiloapps.io"

export const migrateLegacyKiloAuth = gatewayFn("migrateLegacyKiloAuth")
export const fetchDefaultModel = gatewayFn("fetchDefaultModel")
export const fetchProfile = gatewayFn("fetchProfile")
export const fetchBalance = gatewayFn("fetchBalance")
export const fetchKiloModels = gatewayFn("fetchKiloModels")
export const fetchKiloEmbeddingModelCatalog = gatewayFn("fetchKiloEmbeddingModelCatalog")
export const fetchOrganizationModes = gatewayFn("fetchOrganizationModes")
export const fetchCloudSession = gatewayFn("fetchCloudSession")
export const fetchCloudSessionForImport = gatewayFn("fetchCloudSessionForImport")
export const getCloudSessions = gatewayFn("getCloudSessions")
export const importSessionToDb = gatewayFn("importSessionToDb")
// getToken and getOrganizationId are synchronous in the original gateway.
// Use require() for sync access when not in Bedrock-only mode.
let _syncCache: any = null
function getSyncGateway(): any {
  if (isBedrockOnlyEnabled()) return null
  if (_syncCache) return _syncCache
  try { _syncCache = require("@kilocode/kilo-gateway") } catch { return null }
  return _syncCache
}

export function getToken(info: any): string | undefined {
  if (isBedrockOnlyError()) return undefined
  const mod = getSyncGateway()
  return mod?.getToken?.(info)
}

export function getOrganizationId(info: any): string | undefined {
  if (isBedrockOnlyError()) return undefined
  const mod = getSyncGateway()
  return mod?.getOrganizationId?.(info)
}

function isBedrockOnlyError(): boolean {
  return isBedrockOnlyEnabled()
}
export const clearModesCache = gatewayFn("clearModesCache")
export const fetchKilocodeNotifications = gatewayFn("fetchKilocodeNotifications")
export const buildKiloHeaders = gatewayFn("buildKiloHeaders")
