import * as vscode from "vscode"
import type { Server } from "../../server"
import { setAutocompleteTelemetrySink } from "../autocomplete/classic-auto-complete/AutocompleteTelemetry"
import { TelemetryProxy } from "./telemetry-proxy"

export { TelemetryEventName, type TelemetryPropertiesProvider } from "./types"
export { TelemetryProxy } from "./telemetry-proxy"

/** The properties every extension event carries. */
export function telemetryProperties(version: string): Record<string, unknown> {
  return {
    appName: "kilo-code",
    appVersion: version,
    platform: "vscode",
    editorName: vscode.env.appName,
    vscodeVersion: vscode.version,
    machineId: vscode.env.machineId,
    vscodeIsTelemetryEnabled: vscode.env.isTelemetryEnabled,
  }
}

/**
 * Wire extension telemetry: the properties provider, the autocomplete sink and the consent sync. The returned hooks
 * follow the server lifecycle; a started server gets the current consent, a stopped one drops events.
 */
export function registerTelemetry(input: {
  context: Pick<vscode.ExtensionContext, "subscriptions">
  version: string
  proxy?: TelemetryProxy
}) {
  const proxy = input.proxy ?? TelemetryProxy.getInstance()
  proxy.setProvider({ getTelemetryProperties: () => telemetryProperties(input.version) })
  setAutocompleteTelemetrySink((event, properties) => proxy.capture(event, properties))
  input.context.subscriptions.push(
    vscode.env.onDidChangeTelemetryEnabled((enabled) => proxy.setEnabled(enabled)),
    { dispose: () => setAutocompleteTelemetrySink(undefined) },
  )
  return {
    started: (server: Pick<Server, "url" | "authorization">) => proxy.configure(server),
    stopped: () => proxy.reset(),
  }
}
