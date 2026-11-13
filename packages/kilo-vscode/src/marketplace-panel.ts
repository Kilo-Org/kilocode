// The Marketplace editor panel: one "Kilo Marketplace" tab that browses the server-owned catalog and manages
// installations. It loads the shared settings bundle with the marketplace root view.
import { workspace, type ExtensionContext } from "vscode"
import { editorPanel } from "./editor-panel"
import type { Manager } from "./server"

const TYPE = "kilo-code.v2.marketplacePanel"

export function marketplace(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const base = editorPanel({
    context: input.context,
    server: input.server,
    directory: input.directory,
    type: TYPE,
    title: "Kilo Marketplace",
    view: "marketplace",
    // Read when the panel HTML is built, not at activation, so opening or closing a folder is reflected.
    globals: {
      get KILO_HAS_WORKSPACE() {
        return (workspace.workspaceFolders?.length ?? 0) > 0
      },
    },
  })
  return {
    open: base.open,
    dispose: base.dispose,
  }
}
