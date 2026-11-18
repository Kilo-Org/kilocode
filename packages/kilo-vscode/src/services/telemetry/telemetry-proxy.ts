import { TelemetryEventName, type TelemetryPropertiesProvider } from "./types"
import { buildTelemetryPayload, buildTelemetryAuthHeader } from "./telemetry-proxy-utils"

/**
 * Singleton proxy that captures telemetry events and forwards them to the CLI
 * server via POST /telemetry/capture. The CLI handles PostHog delivery.
 */
export class TelemetryProxy {
  private static singleton: TelemetryProxy | undefined

  private url: string | undefined
  private password: string | undefined
  private provider: TelemetryPropertiesProvider | undefined

  private constructor() {}

  static getInstance(): TelemetryProxy {
    return (TelemetryProxy.singleton ??= new TelemetryProxy())
  }

  static capture(event: TelemetryEventName, properties?: Record<string, unknown>) {
    console.log("[telemetry]", event, properties ?? "")
    TelemetryProxy.getInstance().capture(event, properties)
  }

  /**
   * Configure the CLI server connection. Must be called before capture() will send events.
   */
  configure(url: string, password: string) {
    this.url = url
    this.password = password
  }

  setProvider(provider: TelemetryPropertiesProvider) {
    this.provider = provider
  }

  /**
   * Fire-and-forget capture. Enriches with provider properties, then POSTs to CLI.
   * Consent is decided by the CLI core from the Kilo config; clients must not gate it.
   */
  capture(event: TelemetryEventName, properties?: Record<string, unknown>) {
    if (!this.url || !this.password) return

    const built = buildTelemetryPayload(event, properties, this.provider?.getTelemetryProperties())
    if (!built) return
    const payload = JSON.stringify(built)
    const auth = buildTelemetryAuthHeader(this.password)

    fetch(`${this.url}/telemetry/capture`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: payload,
    }).catch((err) => console.error("[Kilo New] Telemetry capture failed:", err))
  }

  /** Read the core's configured telemetry level, or null when the CLI is unavailable. */
  async level(): Promise<boolean | null> {
    if (!this.url || !this.password) return null
    try {
      const res = await fetch(`${this.url}/telemetry/level`, {
        headers: { Authorization: buildTelemetryAuthHeader(this.password) },
      })
      if (!res.ok) return null
      const body = (await res.json()) as { enabled?: unknown }
      return typeof body.enabled === "boolean" ? body.enabled : null
    } catch (err) {
      console.error("[Kilo New] Telemetry level read failed:", err)
      return null
    }
  }

  /**
   * Persist the telemetry level through the CLI core. The core writes
   * `experimental.openTelemetry` and applies it to the running telemetry client.
   */
  async setLevel(enabled: boolean): Promise<boolean | null> {
    if (!this.url || !this.password) return null
    try {
      const res = await fetch(`${this.url}/telemetry/level`, {
        method: "POST",
        headers: {
          Authorization: buildTelemetryAuthHeader(this.password),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) return null
      const body = (await res.json()) as { enabled?: unknown }
      return typeof body.enabled === "boolean" ? body.enabled : enabled
    } catch (err) {
      console.error("[Kilo New] Telemetry level write failed:", err)
      return null
    }
  }

  /**
   * No-op — the CLI server handles PostHog shutdown.
   */
  shutdown() {}
}
