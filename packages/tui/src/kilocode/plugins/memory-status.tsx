import type { Plugin } from "@opencode/plugin/tui"
import { MemorySidebar } from "../components/memory-status"

export function sidebarMemory(context: Plugin.Context) {
  return context.ui.slot({
    append: "sidebar.content",
    order: 1000,
    render: (props) => <MemorySidebar context={context} sessionID={props.sessionID} />,
  })
}
