// KiloClaw SolidJS webview entry point

import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "./kiloclaw.css"
import { KiloClawApp } from "./KiloClawApp"

const root = document.getElementById("root")
if (root) {
  render(() => <KiloClawApp />, root)
}
