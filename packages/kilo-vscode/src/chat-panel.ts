// Chat editor tabs: one tab per session, plus tabs in new-session mode, each with its own webview, relay bridge and
// event stream. Opening a session that already has a tab reveals it, and the serializer reattaches every tab to the
// session it shows after a window reload. The tab state is the webview's own state, so each tab restores itself.
import { Uri, ViewColumn, window, type ExtensionContext, type WebviewPanel } from "vscode"
import { wire, type ChangesTab, type ChatWorktree } from "./chat"
import type { DocumentViewerProvider } from "./DocumentViewerProvider"
import type { GitChanges } from "./git-changes"
import type { GitChangesStats } from "./protocol"
import type { Manager } from "./server"
import type { ToolDiff } from "./tool-diff"

export const CHAT_PANEL_TYPE = "kilo-code.v2.chatPanel"

const TITLE = "Kilo Code"

/** What a chat tab keeps in its own webview state. The host restores the tab from it, not from shared state. */
export type ChatPanelTarget = {
  /** The session the tab shows; undefined for a tab that has not started a session yet. */
  sessionID?: string
  directory: string
}

type Entry = {
  panel: WebviewPanel
  /** The session the tab shows, updated when the webview switches to another one. */
  sessionID?: string
  dispose: () => void
}

export function chatPanels(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  trackCostSession?: (sessionID: string) => void
  diff?: ToolDiff
  changes?: ChangesTab
  /** Creates the working tree stats source of a tab, pushing each change to `onStats`. */
  gitStats?: (onStats: (stats?: GitChangesStats) => void) => GitChanges
  worktree?: ChatWorktree
  openBrowser?: (sessionId: string, url: string) => boolean
  documents?: () => DocumentViewerProvider | undefined
}) {
  const entries = new Set<Entry>()
  const serializer = window.registerWebviewPanelSerializer(CHAT_PANEL_TYPE, {
    deserializeWebviewPanel: async (panel, state) => {
      const target = restoredTarget(state)
      // A tab from before this state existed, or one whose session another tab already shows, has nothing to show.
      if (!target || find(target.sessionID)) return panel.dispose()
      attach(panel, target)
    },
  })

  const find = (sessionID: string | undefined) =>
    sessionID === undefined ? undefined : [...entries].find((entry) => entry.sessionID === sessionID)

  /** Opens a tab on the session, revealing the tab that already shows it; a session-less call opens a new tab. */
  const open = (sessionID?: string) => {
    const existing = find(sessionID)
    if (existing) {
      existing.panel.reveal(ViewColumn.Active)
      return existing.panel
    }
    return attach(
      window.createWebviewPanel(CHAT_PANEL_TYPE, TITLE, ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
      { sessionID, directory: input.directory },
    )
  }

  return {
    open,
    dispose: () => {
      serializer.dispose()
      for (const entry of [...entries]) entry.panel.dispose()
    },
  }

  function attach(panel: WebviewPanel, target: ChatPanelTarget) {
    const root = input.context.extensionUri
    panel.iconPath = {
      light: Uri.joinPath(root, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(root, "assets", "icons", "kilo-dark.svg"),
    }
    let stats: GitChanges | undefined
    const surface = wire({
      context: input.context,
      server: input.server,
      directory: target.directory,
      webview: panel.webview,
      view: "chat",
      surface: "editor",
      sessionID: target.sessionID,
      trackCostSession: input.trackCostSession,
      diff: input.diff,
      changes: input.changes,
      gitStats: () => stats?.read() ?? Promise.resolve(undefined),
      worktree: input.worktree,
      openBrowser: input.openBrowser,
      documents: input.documents,
      handle: (message) => {
        // The tab reports the session it shows. Keep it for dedupe and the next reveal; the tab writes the same value
        // into its own state, which is what a reload restores from. The sidebar's global session is its own.
        if (message.type === "sidebar.session") {
          entry.sessionID = message.sessionId
          return true
        }
        // The sidebar owns the focus context and the code-action target; an editor tab leaves both alone.
        return message.type === "webviewFocusChanged"
      },
    })
    const entry: Entry = { panel, sessionID: target.sessionID, dispose: surface.dispose }
    stats = input.gitStats?.((value) => surface.post({ type: "gitChangesStats", stats: value }))
    stats?.setVisible(panel.visible)
    const visibility = panel.onDidChangeViewState(() => stats?.setVisible(panel.visible))
    entries.add(entry)
    panel.onDidDispose(() => {
      visibility.dispose()
      stats?.dispose()
      surface.dispose()
      entries.delete(entry)
    })
    return panel
  }
}

/** The target a restored tab saved in its webview state, or undefined for a state without one. */
export function restoredTarget(state: unknown): ChatPanelTarget | undefined {
  if (!state || typeof state !== "object") return undefined
  const record = state as Record<string, unknown>
  if (typeof record.directory !== "string" || !record.directory) return undefined
  const sessionID = record.sessionID
  if (sessionID !== undefined && sessionID !== null && typeof sessionID !== "string") return undefined
  return { sessionID: sessionID || undefined, directory: record.directory }
}
