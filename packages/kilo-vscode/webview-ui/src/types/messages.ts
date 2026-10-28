// The v1 webview protocol is gone: the webview reads the v2 server through the relay. The remaining host messages
// are defined with the relay in src/protocol.ts.
import type { ToHost, ToWebview } from "../../../src/protocol"

export interface VSCodeAPI {
  postMessage(message: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

export type WebviewMessage = ToHost
export type ExtensionMessage = ToWebview

declare global {
  function acquireVsCodeApi(): VSCodeAPI
}
