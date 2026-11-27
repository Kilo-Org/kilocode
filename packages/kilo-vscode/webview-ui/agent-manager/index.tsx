// The Agent Manager webview entry. The panel owns its relay and its per-directory stores, so it mounts only the shared
// webview providers.
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import { WebviewShell } from "../src/v2/shell"
import { AgentManagerApp } from "./AgentManagerApp"
import "../src/styles/chat.css"

const root = document.getElementById("root")
if (root) {
  render(
    () => (
      <WebviewShell>
        <AgentManagerApp />
      </WebviewShell>
    ),
    root,
  )
  // Warm libghostty WASM after initial paint and IPC settle so terminal compilation does not compete with startup.
  const warm = () => {
    void import("./terminal/ghostty").then((mod) => mod.preloadGhostty()).catch(() => undefined)
  }
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 2_000 })
  else setTimeout(warm, 1_500)
}
