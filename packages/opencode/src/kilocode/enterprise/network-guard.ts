/**
 * Centralized network guard for enterprise Bedrock-only mode.
 *
 * When BEDROCK_ONLY is enabled, this module intercepts fetch/HTTP calls
 * and blocks any request to endpoints that are not AWS Bedrock.
 */

import { isBedrockOnlyEnabled, isBedrockAllowedUrl } from "./bedrock-only"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "network-guard" })

let installed = false

export class BlockedNetworkError extends Error {
  constructor(url: string) {
    super(
      `Network request to ${url} is blocked in enterprise Bedrock-only mode. ` +
        "Only AWS Bedrock endpoints are allowed.",
    )
    this.name = "BlockedNetworkError"
  }
}

const BLOCKED_DOMAINS = [
  "kilo.ai",
  "kiloapps.io",
  "kilosessions.ai",
  "kilocode.ai",
  "api.kilo.ai",
  "app.kilo.ai",
  "chat.kiloapps.io",
  "events.kiloapps.io",
  "posthog.com",
  "i.posthog.com",
  "us.i.posthog.com",
  "models.dev",
]

export function installNetworkGuard(): void {
  if (installed) return
  if (!isBedrockOnlyEnabled()) return

  installed = true

  const originalFetch = globalThis.fetch
  globalThis.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (!isBedrockAllowedUrl(url)) {
      const host = extractHost(url)
      if (isBlockedDomain(host)) {
        log.error("BLOCKED network request", { url, host })
        return Promise.reject(new BlockedNetworkError(url))
      }

      for (const blocked of BLOCKED_DOMAINS) {
        if (host.includes(blocked) || url.includes(blocked)) {
          log.error("BLOCKED network request", { url, host, blocked })
          return Promise.reject(new BlockedNetworkError(url))
        }
      }
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
      const host = extractHost(urlStr)

      if (!isBedrockAllowedUrl(urlStr)) {
        for (const blocked of BLOCKED_DOMAINS) {
          if (host.includes(blocked) || urlStr.includes(blocked)) {
            log.error("BLOCKED WebSocket connection", { url: urlStr, host })
            throw new BlockedNetworkError(urlStr)
          }
        }
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

function isBlockedDomain(host: string): boolean {
  return BLOCKED_DOMAINS.some((d) => host.includes(d))
}

export function disableTelemetryExports(): void {
  if (!isBedrockOnlyEnabled()) return

  process.env.KILO_TELEMETRY_LEVEL = "off"
  process.env.POSTHOG_DISABLED = "1"
  process.env.DO_NOT_TRACK = "1"
}
