/**
 * Host interface — abstracts all VS Code capabilities the Agent Manager needs.
 *
 * Implemented by vscode-host.ts using real VS Code APIs. Alternative
 * implementations (Tauri, web, CLI) can provide their own adapter.
 *
 * No file in src/agent-manager/ should import "vscode" except the adapter
 * files listed in the architecture test allowlist.
 */

import type { Session } from "@kilocode/sdk/v2/client"
import type { ProjectRef, SessionRef, WorktreeRef } from "./project/route"

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void
}

// ---------------------------------------------------------------------------
// Output channel
// ---------------------------------------------------------------------------

export interface OutputHandle {
  appendLine(msg: string): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// Session provider (abstracts KiloProvider interactions)
// ---------------------------------------------------------------------------

export interface SessionProvider {
  setSessionDirectory(id: string, directory: string): void
  clearSessionDirectory(id: string): void
  getSessionDirectories(): ReadonlyMap<string, string>
  getSessionInfo?(id: string): Promise<Session | undefined>
  /** List root sessions (no parent) whose directory exactly matches `dir`. */
  listSessions?(dir: string): Promise<Session[]>
  trackSession(id: string): void
  refreshSessions(): void
  registerSession(session: Session): void
  /** Recover any pending permission/question prompts for tracked sessions. */
  recoverPendingPrompts(): void
  /** Register a callback invoked when a plan follow-up session is adopted.
   *  The callback receives the new session and its directory so the Agent Manager
   *  can route it to the correct worktree instead of LOCAL. */
  onFollowupAdopted(cb: (session: Session, directory: string) => void): void
  acknowledgeDraft(draftID: string, sessionID: string): void
  abortSessions(ids: readonly string[]): Promise<void>
  showMemory(sessionID?: string): Promise<void>
  toggleMemory(sessionID?: string): Promise<void>
  /** Register a project root with the shared route service. */
  registerProjectRoute?(ref: ProjectRef, root: string, generation: number): void
  /** Drop a project and all its session/worktree routes. */
  unregisterProjectRoute?(projectId: string): void
  /** Register a worktree directory under a project. */
  registerWorktreeRoute?(ref: WorktreeRef, directory: string, generation: number): void
  /** Register a session directory under a project (exact routing). */
  registerSessionRoute?(ref: SessionRef, directory: string, generation: number): void
  /** Drop one session route (keeps the raw ambiguity index consistent). */
  unregisterSessionRoute?(ref: SessionRef): void
  /** Whether a raw session id is known to be ambiguous across projects. */
  isSessionRouteAmbiguous?(sessionId: string): boolean
  /** Exact directory for a project-qualified session ref, or undefined. */
  routeSessionDirectoryFor?(ref: SessionRef): string | undefined
  /** Re-check Git capability for the active project/session directory. */
  refreshGitStatus?(): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// Host — the single interface for all platform capabilities
// ---------------------------------------------------------------------------

/** Result of opening a panel — bundles the messaging handle + session provider. */
export interface PanelContext {
  /** Send a message to the webview. */
  postMessage(msg: unknown): void

  /** Resolve once the panel webview is ready to receive messages. */
  waitForReady(): Promise<void>

  /** Resolve once the panel is the active editor tab. */
  waitForActive(): Promise<void>

  /** Reveal the panel. */
  reveal(preserveFocus?: boolean): void

  /** Whether the panel is currently the active tab. */
  readonly active: boolean

  /** Whether the panel is visible (may be unfocused in a split editor group). */
  readonly visible: boolean

  /** Session provider wired to this panel. */
  readonly sessions: SessionProvider

  /** Register a callback for when panel visibility changes. */
  onDidChangeVisibility(cb: (visible: boolean) => void): Disposable

  /** Register a callback for when the panel is disposed. */
  onDidDispose(cb: () => void): Disposable

  /** Dispose the panel and all associated resources. */
  dispose(): void
}

export interface Host {
  /**
   * Create (or restore) a webview panel wired with a session provider.
   * The host handles HTML generation, icon paths, CSP, and KiloProvider setup.
   *
   * @param opts.onBeforeMessage — interceptor for messages from the webview
   */
  openPanel(opts: {
    onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    worktreeDirectories?: () => string[]
    /** Dynamic root directory for the panel's session provider (follows the active project). */
    workspaceRoot?: () => string | undefined
    projectId?: () => string | undefined
  }): PanelContext

  /** Get the workspace/project root path. */
  workspacePath(): string | undefined

  /** Show a folder picker and return the selected path, or undefined when cancelled. */
  pickFolder(): Promise<string | undefined>

  /** Whether the experimental multi-project Agent Manager mode is enabled. */
  multiProject(): boolean

  /** Read the persisted additional-project registry payload. */
  readProjects(): unknown

  /** Persist the additional-project registry payload. */
  writeProjects(value: unknown): Promise<void>

  unregisterProjectRoutes(projectId: string): void

  /** Subscribe to workspace folder changes (pinned project re-derivation). */
  onDidChangeWorkspaceFolders(cb: () => void): Disposable

  /** Subscribe to multi-project flag changes. */
  onDidChangeMultiProject(cb: (enabled: boolean) => void): Disposable
  /** Whether the workspace permits executing configured scripts. */
  isTrusted(): boolean

  /** Read the user's automatic branch naming preferences. */
  autoBranchNaming(): { enabled: boolean; prefix: string }

  /** Show an error notification. */
  showError(msg: string): void

  /** Open a text document in an editor (e.g. setup script). */
  openDocument(path: string): Promise<void>

  /** Open a file at a specific location in the editor. */
  openFile(path: string, line?: number, column?: number): void

  /** Open a folder (optionally in a new window). */
  openFolder(path: string, newWindow: boolean): void

  /** Create an output channel for logging. */
  createOutput(name: string): OutputHandle

  /** Read extension keybinding metadata. */
  extensionKeybindings(): Array<{ command: string; key?: string; mac?: string }>

  /** Copy text to the system clipboard. */
  copyToClipboard(text: string): void

  /** Capture a telemetry event. */
  capture(event: string, properties?: Record<string, unknown>): void

  /** Open a URL in the user's default browser. */
  openExternal(url: string): void

  /** Ask VS Code's git extension to re-scan repositories (e.g. after worktree ref migration). */
  refreshGit(): void

  /** Dispose all host resources. */
  dispose(): void
}
