import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import { WebviewShell } from "../src/v2/shell"
import { BrowserTabApp } from "./BrowserTabApp"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <WebviewShell>
      <BrowserTabApp />
    </WebviewShell>
  ),
  root,
)