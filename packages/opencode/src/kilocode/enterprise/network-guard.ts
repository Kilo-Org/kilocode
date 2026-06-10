/**
 * Centralized network guard for enterprise Bedrock-only mode.
 *
 * When BEDROCK_ONLY is enabled, this module intercepts fetch/HTTP calls
 * and blocks ANY request that is not to the allowed AWS Bedrock eu-west-1 endpoint.
 *
 * Strategy: default-deny. Only explicit allowlisted hosts pass through.
 */

import { isBedrockOnlyEnabled, ALLOWED_BEDROCK_REGION } from "./bedrock-only"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "network-guard" })

let installed = false

/** Reset the installed flag — for test isolation only. */
export function _resetInstalledFlag(): void {
  installed = false
}

export class BlockedNetworkError extends Error {
  constructor(url: string) {
    super(
      `Network request to ${url} is blocked in enterprise Bedrock-only mode. ` +
        `Only AWS Bedrock in region ${ALLOWED_BEDROCK_REGION} is allowed.`,
    )
    this.name = "BlockedNetworkError"
  }
}

const ALLOWED_HOSTS = new Set([
  `bedrock-runtime.${ALLOWED_BEDROCK_REGION}.amazonaws.com`,
  `bedrock.${ALLOWED_BEDROCK_REGION}.amazonaws.com`,
])

function isAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export function installNetworkGuard(): void {
  if (installed) return
  if (!isBedrockOnlyEnabled()) return

  installed = true

  const originalFetch = globalThis.fetch
  globalThis.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (!isAllowed(url)) {
      const host = extractHost(url)
      log.error("BLOCKED network request (enterprise Bedrock-only)", { url, host })
      return Promise.reject(new BlockedNetworkError(url))
    }

    return originalFetch.call(globalThis, input, init)
  } as any // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
}

export function installWebSocketGuard(): void {
  if (!isBedrockOnlyEnabled()) return

  const OriginalWebSocket = globalThis.WebSocket
  if (!OriginalWebSocket) return

  class GuardedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === "string" ? url : url.toString()

      if (!isAllowed(urlStr)) {
        const host = extractHost(urlStr)
        log.error("BLOCKED WebSocket connection (enterprise Bedrock-only)", { url: urlStr, host })
        throw new BlockedNetworkError(urlStr)
      }

      super(url, protocols)
    }
  }

  globalThis.WebSocket = GuardedWebSocket as any // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function disableTelemetryExports(): void {
  if (!isBedrockOnlyEnabled()) return

  process.env.KILO_TELEMETRY_LEVEL = "off"
  process.env.POSTHOG_DISABLED = "1"
  process.env.DO_NOT_TRACK = "1"
}
