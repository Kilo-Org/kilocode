// The Agent Manager webview entry. The panel owns its relay and its per-directory stores, so it mounts only the shared
// webview providers.
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import { WebviewShell } from "../src/v2/shell"
import { AgentManagerApp } from "./AgentManagerApp"
import "../src/styles/chat.css"

const root = document.getElementById("root")
if (root)
  render(
    () => (
      <WebviewShell>
        <AgentManagerApp />
      </WebviewShell>
    ),
    root,
  )
