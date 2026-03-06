// Diff Viewer SolidJS entry point
// Opens as an editor tab from the sidebar "Show Changes" button.
// Reuses the Agent Manager's FullScreenDiffView + review comments.

import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import { DiffViewerApp } from "./DiffViewerApp"

const root = document.getElementById("root")
if (root) {
  render(() => <DiffViewerApp />, root)
}
