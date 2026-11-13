import { OpenCode } from "@opencode/client"
import { KiloTelemetryRpc } from "@opencode/schema/kilocode/telemetry"
import * as vscode from "vscode"
import { local } from "../../local"
import type { Server } from "../../server"
import { buildTelemetryPayload } from "./telemetry-proxy-utils"
import type { TelemetryPropertiesProvider } from "./types"

type Rpc = {
  capture(input: KiloTelemetryRpc.Capture): Promise<unknown>
  setEnabled(input: { enabled: boolean }): Promise<unknown>
}

/**
 * Singleton proxy that captures telemetry events and forwards them to the running Kilo server through the
 * `kilocode.telemetry` RPC; the server delivers them to PostHog. Events are dropped while no server runs, and while
 * VS Code telemetry is off. The VS Code telemetry setting is the consent: the proxy records it on the server after
 * every start and whenever it changes, because a fresh server starts without consent and sends nothing.
 */
export class TelemetryProxy {
  private static singleton: TelemetryProxy | undefined

  private rpc: Rpc | undefined
  private provider: TelemetryPropertiesProvider | undefined
  /** The pending consent call; a capture waits for it so the first events of a new server are not dropped. */
  private ready: Promise<unknown> = Promise.resolve()

  constructor(private readonly log: (message: string, error: unknown) => void = console.error) {}

  static getInstance(): TelemetryProxy {
    return (TelemetryProxy.singleton ??= new TelemetryProxy())
  }

  static capture(event: string, properties?: Record<string, unknown>) {
    TelemetryProxy.getInstance().capture(event, properties)
  }

  /** Connect to a started server and record the current consent there. */
  configure(server: Pick<Server, "url" | "authorization">, connect: (server: Pick<Server, "url" | "authorization">) => Rpc = rpc) {
    this.rpc = connect(server)
    this.setEnabled(this.isVSCodeTelemetryEnabled())
  }

  /** The server stopped: drop events until the next one starts. */
  reset() {
    this.rpc = undefined
    this.ready = Promise.resolve()
  }

  setProvider(provider: TelemetryPropertiesProvider) {
    this.provider = provider
  }

  isVSCodeTelemetryEnabled(): boolean {
    return vscode.env.isTelemetryEnabled
  }

  /** Fire-and-forget capture. Enriches with provider properties, then sends to the server. */
  capture(event: string, properties?: Record<string, unknown>) {
    if (!this.isVSCodeTelemetryEnabled()) return
    const rpc = this.rpc
    if (!rpc) return
    const built = buildTelemetryPayload(event, properties, this.provider?.getTelemetryProperties())
    if (!built) return
    void this.ready
      .then(() => rpc.capture(built))
      .catch((error: unknown) => this.log("Telemetry capture failed", error))
  }

  /** Record a consent change on the running server, so its delivery follows the VS Code setting at once. */
  setEnabled(enabled: boolean) {
    const rpc = this.rpc
    if (!rpc) return
    this.ready = rpc.setEnabled({ enabled }).catch((error: unknown) => this.log("Telemetry setEnabled failed", error))
  }
}

function rpc(server: Pick<Server, "url" | "authorization">): Rpc {
  // No location: events belong to the server's own location, the workspace the extension started it in.
  return OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local }).rpc(
    KiloTelemetryRpc.Definition,
  )
}
