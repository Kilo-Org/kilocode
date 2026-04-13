// kilocode_change - new file
// Kilo-specific overrides for the server control plane.
// Imported by ../../server/server.ts with minimal kilocode_change markers.

import { ModelCache } from "../../provider/model-cache"

/** Extra paths to skip request logging for */
export function skipLogging(path: string): boolean {
  return path === "/telemetry/capture" || path === "/global/health"
}

/** Additional CORS origin check for *.kilo.ai */
export function corsOrigin(input: string): string | undefined {
  if (/^https:\/\/([a-z0-9-]+\.)*kilo\.ai$/.test(input)) {
    return input
  }
  return undefined
}

/** Invalidate model cache after auth change */
export function authChanged(providerID: string) {
  ModelCache.clear(providerID)
}

export const DOC_TITLE = "kilo"
export const DOC_DESCRIPTION = "kilo api"
