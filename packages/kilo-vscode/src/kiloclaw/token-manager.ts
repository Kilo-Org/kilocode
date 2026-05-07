/**
 * KiloChat access-token cache.
 *
 * Mirrors the web client pattern (see `apps/web/src/app/(app)/claw/kilo-chat/token.ts`
 * in the cloud monorepo). The token is minted by the Kilo gateway
 * (`kilo.claw.chatCredentials`) and kept in memory with a 5-minute freshness
 * buffer. The gateway operation is a historical name — it used to return
 * Stream Chat credentials and was repurposed when Kilo migrated to its own
 * kilo-chat service.
 *
 * Concurrent callers share the same inflight fetch so we never double-issue.
 * A short retry cooldown prevents tight loops when the gateway is flaky.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ChatToken } from "./types"

const FRESHNESS_BUFFER_MS = 5 * 60 * 1000
const RETRY_BACKOFF_MS = 5_000

export class TokenManager {
  private cached: ChatToken | null = null
  private expiresAtMs = 0
  private inflight: Promise<ChatToken> | null = null
  private lastFailedAt = 0

  constructor(private readonly getClient: () => KiloClient | null) {}

  /** Latest resolved token info (may be stale). Used for URL extraction. */
  peek(): ChatToken | null {
    return this.cached
  }

  /** Drop the cached token; next `get` will refetch. */
  clear(): void {
    this.cached = null
    this.expiresAtMs = 0
    this.lastFailedAt = 0
    this.inflight = null
  }

  async get(): Promise<string> {
    const info = await this.getOrFetch()
    return info.token
  }

  /** Resolve the full token envelope (URLs + token + expiry). */
  async getOrFetch(): Promise<ChatToken> {
    if (this.cached && Date.now() < this.expiresAtMs - FRESHNESS_BUFFER_MS) {
      return this.cached
    }
    if (this.lastFailedAt && Date.now() - this.lastFailedAt < RETRY_BACKOFF_MS) {
      throw new Error("Kilo chat token fetch on cooldown after recent failure")
    }
    if (!this.inflight) {
      this.inflight = this.fetch()
        .then((info) => {
          this.cached = info
          this.expiresAtMs = new Date(info.expiresAt).getTime()
          this.lastFailedAt = 0
          this.inflight = null
          return info
        })
        .catch((err) => {
          this.lastFailedAt = Date.now()
          this.inflight = null
          throw err
        })
    }
    return this.inflight
  }

  private async fetch(): Promise<ChatToken> {
    const client = this.getClient()
    if (!client) throw new Error("Kilo backend not connected")
    const res = await client.kilo.claw.chatCredentials()
    const errResponse = (res as Record<string, unknown> | null)?.error
    if (!res || errResponse || !res.data) {
      // Propagate the server's error detail when present so the extension's
      // Output channel makes it obvious whether this is an auth problem,
      // "no active instance" (404), or a transient 5xx.
      const detail = this.formatErrorDetail(errResponse)
      throw new Error(`kilo-chat credentials fetch failed${detail ? `: ${detail}` : ""}`)
    }
    const data = res.data as Partial<ChatToken>
    const missing: string[] = []
    if (!data.token) missing.push("token")
    if (!data.expiresAt) missing.push("expiresAt")
    if (!data.kiloChatUrl) missing.push("kiloChatUrl")
    if (!data.eventServiceUrl) missing.push("eventServiceUrl")
    if (missing.length > 0) {
      throw new Error(
        `Malformed kilo-chat credentials response: missing ${missing.join(", ")} (received keys: ${Object.keys(data).join(", ") || "<empty>"})`,
      )
    }
    return {
      token: data.token!,
      expiresAt: data.expiresAt!,
      kiloChatUrl: data.kiloChatUrl!,
      eventServiceUrl: data.eventServiceUrl!,
    }
  }

  private formatErrorDetail(err: unknown): string {
    if (!err) return ""
    if (typeof err === "string") return err
    if (typeof err === "object" && err && "error" in err && typeof err.error === "string") {
      return err.error
    }
    return JSON.stringify(err)
  }
}
