// Agent Manager SolidJS entry point
// Shares components and providers with the sidebar webview
// webviewReady is sent by ServerProvider inside the component tree

import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import { registerExpandedTaskTool } from "../src/components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "../src/components/chat/VscodeToolOverrides"
import { AgentManagerApp } from "./AgentManagerApp"

registerExpandedTaskTool()
registerVscodeToolOverrides()

const root = document.getElementById("root")
if (root) {
  render(() => <AgentManagerApp />, root)
}
