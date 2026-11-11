// The virtual diff viewer bundle of a tool call. The host loads this in the Kilo diff panel.
import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import "./diff-virtual.css"
import { WebviewShell } from "../src/v2/shell"
import { DiffVirtualApp } from "./DiffVirtualApp"

const root = document.getElementById("root")
if (root) {
  render(
    () => (
      <WebviewShell>
        <DiffVirtualApp />
      </WebviewShell>
    ),
    root,
  )
}
