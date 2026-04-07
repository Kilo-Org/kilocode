import { render } from "solid-js/web"
import "@devilcode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import { DiffViewerApp } from "./DiffViewerApp"

const root = document.getElementById("root")

if (root) {
  render(() => <DiffViewerApp />, root)
}
