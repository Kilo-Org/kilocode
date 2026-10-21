import type { ToHost } from "../src/protocol"

declare global {
  function acquireVsCodeApi(): { postMessage(message: ToHost): void }
}
