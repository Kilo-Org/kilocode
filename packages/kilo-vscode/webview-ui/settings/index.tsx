/* @refresh reload */
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import SettingsApp from "../src/v2/SettingsApp"
import "../src/styles/chat.css"
// The Agent Manager settings tab opens a project dialog that carries its own styles, so they join this stylesheet
// instead of a lazy chunk the panel HTML does not link.
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(() => <SettingsApp directory={root.dataset.directory ?? ""} view={root.dataset.view ?? "settings"} />, root)
