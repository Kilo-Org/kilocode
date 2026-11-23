import * as vscode from "vscode"
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
  private readonly change = new vscode.EventEmitter<void>()
  private pending = Promise.resolve()
  private revision = 0

  readonly onChange = this.change.event

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
    if (this.url === url && this.password === password) return
    this.url = url
    this.password = password
    this.pending = Promise.resolve()
    this.setHostEnabled(vscode.env.isTelemetryEnabled)
  }

  setProvider(provider: TelemetryPropertiesProvider) {
    this.provider = provider
  }

  /**
   * Fire-and-forget capture. Enriches with provider properties, then POSTs to CLI.
   * Check the editor opt-out immediately while the CLI also applies its own consent checks.
   */
  capture(event: TelemetryEventName, properties?: Record<string, unknown>) {
    if (!vscode.env.isTelemetryEnabled || !this.url || !this.password) return

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

  setHostEnabled(enabled: boolean) {
    const url = this.url
    const password = this.password
    if (!url || !password) return
    // Apply successive VS Code changes in order, and skip requests for a replaced backend.
    // A failed update must not poison later reads: level() still asks the CLI for the truth.
    this.pending = this.pending.then(async () => {
      if (url !== this.url || password !== this.password) return
      await this.request("/telemetry/setEnabled", enabled)
    })
    this.revision++
    this.change.fire()
  }

  /** Read effective telemetry consent, or null when the CLI is unavailable. */
  async level(): Promise<boolean | null> {
    if (!vscode.env.isTelemetryEnabled) return false
    const revision = this.revision
    await this.pending
    if (revision !== this.revision) return null
    const enabled = await this.read(await this.request("/telemetry/level"))
    return revision === this.revision ? enabled : null
  }

  /**
   * Persist the telemetry level through the CLI core. The core writes
   * `experimental.openTelemetry` and applies it to the running telemetry client.
   */
  async setLevel(enabled: boolean): Promise<boolean | null> {
    const value = await this.read(await this.request("/telemetry/level", enabled))
    if (value !== null) {
      this.revision++
      this.change.fire()
    }
    return value
  }

  private async request(path: string, enabled?: boolean): Promise<Response | null> {
    if (!this.url || !this.password) return null
    try {
      const auth = buildTelemetryAuthHeader(this.password)
      return await fetch(`${this.url}${path}`, {
        signal: AbortSignal.timeout(5000),
        ...(enabled === undefined
          ? { headers: { Authorization: auth } }
          : {
              method: "POST",
              headers: { Authorization: auth, "Content-Type": "application/json" },
              body: JSON.stringify({ enabled }),
            }),
      })
    } catch (err) {
      console.error("[Kilo New] Telemetry request failed:", path, err)
      return null
    }
  }

  private async read(res: Response | null): Promise<boolean | null> {
    if (!res?.ok) return null
    const body = (await res.json().catch((err) => {
      console.error("[Kilo New] Invalid telemetry response:", err)
      return null
    })) as { enabled?: unknown } | null
    return typeof body?.enabled === "boolean" ? body.enabled : null
  }

  /**
   * No-op — the CLI server handles PostHog shutdown.
   */
  shutdown() {}
}
