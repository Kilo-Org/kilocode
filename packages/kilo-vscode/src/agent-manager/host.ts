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
  trackSession(id: string): void
  refreshSessions(): void
  registerSession(session: Session): void
  /** Recover any pending permission/question prompts for tracked sessions. */
  recoverPendingPrompts(): void
  /** Register a callback invoked when a plan follow-up session is adopted.
   *  The callback receives the new session and its directory so the Agent Manager
   *  can route it to the correct worktree instead of LOCAL. */
  onFollowupAdopted(cb: (session: Session, directory: string) => void): void
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
  }): PanelContext

  /** Get the workspace/project root path. */
  workspacePath(): string | undefined

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

  /** Get the CLI server port (for webview CSP). */
  serverPort(): number | undefined

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
