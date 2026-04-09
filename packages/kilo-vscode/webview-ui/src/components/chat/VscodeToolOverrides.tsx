/**
 * VS Code-specific tool registry overrides.
 * Wraps upstream tool renderers to inject VS Code sidebar preferences
 * (e.g. expanded by default) without duplicating render logic.
 *
 * Call registerVscodeToolOverrides() once at app startup, after the
 * upstream tool registrations have run (i.e. after importing message-part).
 */

import { Dynamic } from "solid-js/web"
import { ToolRegistry } from "@kilocode/kilo-ui/message-part"

/** Tools that should be open by default in the VS Code sidebar. */
const DEFAULT_OPEN_TOOLS = ["bash"]

export function registerVscodeToolOverrides() {
  for (const name of DEFAULT_OPEN_TOOLS) {
    const upstream = ToolRegistry.render(name)
    if (!upstream) continue

    ToolRegistry.register({
      name,
      render: (props) => <Dynamic component={upstream} {...props} defaultOpen />,
    })
  }
}
