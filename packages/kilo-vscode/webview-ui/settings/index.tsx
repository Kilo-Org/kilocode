/* @refresh reload */
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import SettingsApp from "../src/v2/SettingsApp"
import "../src/styles/chat.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(() => <SettingsApp directory={root.dataset.directory ?? ""} view={root.dataset.view ?? "settings"} />, root)
