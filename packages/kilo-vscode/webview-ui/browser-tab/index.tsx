import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import { ProviderShell } from "../src/context/provider-shell"
import { BrowserTabApp } from "./BrowserTabApp"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <ProviderShell.Root>
      <BrowserTabApp />
    </ProviderShell.Root>
  ),
  root,
)
