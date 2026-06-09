import type { KiloClient } from "@kilocode/sdk/v2/client"
import { CloudAgentDisconnectedError, CloudAgentSignedOutError, isCloudAgentUnauthorized } from "./errors"
import type { CloudAgentToken } from "./types"

const FRESHNESS_BUFFER_MS = 5 * 60 * 1000
const RETRY_BACKOFF_MS = 5_000

export class CloudAgentStaleTokenError extends Error {}

export class CloudAgentTokenManager {
  private cached: CloudAgentToken | null = null
  private expires = 0
  private inflight: Promise<CloudAgentToken> | null = null
  private failed = 0
  private epoch = 0

  constructor(private readonly getClient: () => KiloClient | null) {}

  peek(): CloudAgentToken | null {
    return this.cached
  }

  clear(): void {
    this.epoch++
    this.cached = null
    this.expires = 0
    this.failed = 0
    this.inflight = null
  }

  retry(): void {
    this.failed = 0
  }

  async get(): Promise<CloudAgentToken> {
    if (this.cached && Date.now() < this.expires - FRESHNESS_BUFFER_MS) return this.cached
    if (this.failed && Date.now() - this.failed < RETRY_BACKOFF_MS) {
      throw new Error("Cloud Agent token fetch on cooldown after recent failure")
    }
    if (!this.inflight) {
      const epoch = this.epoch
      const inflight = this.fetch()
        .then((token) => {
          if (this.epoch !== epoch) throw new CloudAgentStaleTokenError("Cloud Agent token fetch became stale")
          this.cached = token
          this.expires = new Date(token.expiresAt).getTime()
          this.failed = 0
          return token
        })
        .catch((err) => {
          if (
            this.epoch === epoch &&
            !(err instanceof CloudAgentStaleTokenError) &&
            !(err instanceof CloudAgentDisconnectedError) &&
            !(err instanceof CloudAgentSignedOutError)
          )
            this.failed = Date.now()
          throw err
        })
        .finally(() => {
          if (this.inflight === inflight) this.inflight = null
        })
      this.inflight = inflight
    }
    return this.inflight
  }

  private async fetch(): Promise<CloudAgentToken> {
    const client = this.getClient()
    if (!client) throw new CloudAgentDisconnectedError("Kilo backend not connected")

    const res = await client.kilo.cloudAgent.credentials().catch((err) => {
      if (isCloudAgentUnauthorized(err)) throw new CloudAgentSignedOutError("Cloud Agent credentials fetch failed")
      throw err
    })
    if (!res || res.error || !res.data) {
      if (isCloudAgentUnauthorized(res?.error))
        throw new CloudAgentSignedOutError("Cloud Agent credentials fetch failed")
      const detail = this.detail(res?.error)
      throw new Error(`Cloud Agent credentials fetch failed${detail ? `: ${detail}` : ""}`)
    }

    const data = res.data as Partial<CloudAgentToken>
    const missing: string[] = []
    if (!data.token) missing.push("token")
    if (!data.expiresAt) missing.push("expiresAt")
    if (!data.kiloFacadeUrl) missing.push("kiloFacadeUrl")
    if (!data.cloudAgentUrl) missing.push("cloudAgentUrl")
    if (missing.length) {
      throw new Error(
        `Malformed Cloud Agent credentials response: missing ${missing.join(", ")} (received keys: ${Object.keys(data).join(", ") || "<empty>"})`,
      )
    }

    return {
      token: data.token!,
      expiresAt: data.expiresAt!,
      kiloFacadeUrl: data.kiloFacadeUrl!,
      cloudAgentUrl: data.cloudAgentUrl!,
    }
  }

  private detail(err: unknown): string {
    if (!err) return ""
    if (typeof err === "string") return err
    if (typeof err === "object" && "error" in err && typeof err.error === "string") return err.error
    try {
      return JSON.stringify(err)
    } catch {
      return "unserializable error"
    }
  }
}
