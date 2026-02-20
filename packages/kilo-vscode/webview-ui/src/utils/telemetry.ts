/**
 * Thin helper for the webview to send telemetry events to the extension host.
 * The extension host's KiloProvider forwards these to TelemetryProxy → CLI server.
 */

import { getVSCodeAPI } from "../context/vscode"

/**
 * Fire-and-forget telemetry capture from the webview.
 * Posts a message to the extension host which forwards it to the CLI server.
 */
export function captureTelemetryEvent(event: string, properties?: Record<string, unknown>) {
  try {
    getVSCodeAPI().postMessage({ type: "telemetry", event, properties })
  } catch {
    // Never crash on telemetry failures
  }
}
