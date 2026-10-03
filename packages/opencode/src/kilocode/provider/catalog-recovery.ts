import type { KiloModelsResult } from "@kilocode/kilo-gateway"

export function retryable(result: KiloModelsResult) {
  if (!result.error) return Object.keys(result.models).length === 0
  if (result.error.kind === "network") return true
  const status = result.error.status ?? 0
  return result.error.kind === "http" && (status === 408 || status === 429 || status >= 500)
}

export function delay(result: KiloModelsResult, attempt: number) {
  return Math.max(Math.min(30 * 2 ** Math.min(attempt, 4), 300), result.error?.retryAfter ?? 0)
}

export function failure(error: KiloModelsResult["error"]) {
  if (!error) return undefined
  const reason = error.status == null ? error.kind : `HTTP ${error.status}`
  return `Failed to load the Kilo model catalog (${reason}). Check your connection and credentials.`
}

export function unavailable(error: { catalogError?: unknown; modelsEmpty?: unknown }) {
  if (typeof error.catalogError === "string") return error.catalogError
  return error.modelsEmpty === true ? "No models are currently available." : ""
}
