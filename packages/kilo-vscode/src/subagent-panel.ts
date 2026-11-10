// Subagent editor tabs: one read-only tab per child session, revealed again when it is open and restored after a
// window reload. Each tab loads the chat bundle with the subagent root view, which renders the child session with live
// updates. The sidebar and an open subagent tab open them; the Agent Manager shows subagents in its own inspector.
import { Uri, ViewColumn, window, type ExtensionContext, type WebviewPanel } from "vscode"
import type { DocumentViewerProvider } from "./DocumentViewerProvider"
import { wire } from "./chat"
import type { SubagentTarget } from "./protocol"
import type { Manager } from "./server"
import type { ToolDiff } from "./tool-diff"

export const SUBAGENT_PANEL_TYPE = "kilo-code.v2.subagentPanel"

/** The tab target with the directory store that owns the child session. */
export type SubagentPanelTarget = SubagentTarget & { directory: string }

export function subagentPanels(input: {
  context: ExtensionContext
  server: Manager
  diff?: ToolDiff
  documents?: () => DocumentViewerProvider | undefined
  /** Shows the parent session in the sidebar when the user leaves a subagent tab. */
  showParent?: (sessionID: string) => void
}) {
  const panels = new Map<string, WebviewPanel>()
  const serializer = window.registerWebviewPanelSerializer(SUBAGENT_PANEL_TYPE, {
    deserializeWebviewPanel: async (panel, state) => {
      const target = restoredTarget(state)
      // A tab from before this state existed has nothing to show.
      if (!target || panels.has(target.sessionID)) return panel.dispose()
      attach(panel, target)
    },
  })

  const open = (target: SubagentPanelTarget) => {
    const existing = panels.get(target.sessionID)
    if (existing) {
      existing.reveal(ViewColumn.One)
      return existing
    }
    return attach(
      window.createWebviewPanel(SUBAGENT_PANEL_TYPE, subagentTitle(target.title), ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
      target,
    )
  }

  return {
    open,
    dispose: () => {
      serializer.dispose()
      for (const panel of [...panels.values()]) panel.dispose()
    },
  }

  function attach(panel: WebviewPanel, target: SubagentPanelTarget) {
    const root = input.context.extensionUri
    panel.iconPath = {
      light: Uri.joinPath(root, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(root, "assets", "icons", "kilo-dark.svg"),
    }
    panel.title = subagentTitle(target.title)
    panels.set(target.sessionID, panel)
    const surface = wire({
      context: input.context,
      server: input.server,
      directory: target.directory,
      webview: panel.webview,
      view: "subagent",
      diff: input.diff,
      documents: input.documents,
      globals: { KILO_SUBAGENT: target },
      handle: (message) => {
        if (message.type !== "subagentBack") return false
        panel.dispose()
        if (target.parentSessionID) input.showParent?.(target.parentSessionID)
        return true
      },
    })
    panel.onDidDispose(() => {
      surface.dispose()
      if (panels.get(target.sessionID) === panel) panels.delete(target.sessionID)
    })
    return panel
  }
}

export function subagentTitle(title: string | undefined) {
  const text = title?.trim()
  return text ? `Sub-agent: ${text}` : "Sub-agent"
}

/** The target a restored tab saved in its webview state, or undefined for a state without one. */
export function restoredTarget(state: unknown): SubagentPanelTarget | undefined {
  if (!state || typeof state !== "object" || !("subagent" in state)) return undefined
  const value = state.subagent
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.sessionID !== "string" || !record.sessionID) return undefined
  if (typeof record.directory !== "string" || !record.directory) return undefined
  return {
    sessionID: record.sessionID,
    directory: record.directory,
    title: typeof record.title === "string" ? record.title : undefined,
    parentSessionID: typeof record.parentSessionID === "string" ? record.parentSessionID : undefined,
  }
}
