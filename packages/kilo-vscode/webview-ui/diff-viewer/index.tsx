import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import { WebviewShell } from "../src/v2/shell"
import { DiffViewerApp } from "./DiffViewerApp"

const root = document.getElementById("root")

if (root) {
  render(
    () => (
      <WebviewShell>
        <DiffViewerApp />
      </WebviewShell>
    ),
    root,
  )
}
