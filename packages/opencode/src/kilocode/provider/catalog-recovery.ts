import type { KiloModelsResult } from "@kilocode/kilo-gateway"

export function retryable(result: KiloModelsResult) {
  if (!result.error) return Object.keys(result.models).length === 0
  if (result.error.kind === "network") return true
  const status = result.error.status ?? 0
  return result.error.kind === "http" && (status === 408 || status >= 500)
}
