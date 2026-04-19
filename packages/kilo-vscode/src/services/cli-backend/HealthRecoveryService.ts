import * as vscode from "vscode"
import { KiloLogger } from "../KiloLogger"
import type { KiloConnectionService, ConnectionState } from "./connection-service"

/**
 * High-level health state surfaced to the About page and status bar.
 *
 * - healthy:       KiloConnectionService reports "connected" and the most recent
 *                  poll succeeded. No recovery in progress.
 * - degraded:      Connected but we recently observed transient errors
 *                  (e.g. intermittent health-poll failure that has since recovered).
 * - disconnected:  KiloConnectionService reports "disconnected" or "error" and
 *                  we have exhausted the current retry budget / are idle between
 *                  retries that have not yet fired.
 * - recovering:    An active reconnect attempt is in flight, or we are counting
 *                  down to the next scheduled retry.
 */
export type HealthStatus = "healthy" | "degraded" | "disconnected" | "recovering"

/**
 * Snapshot broadcast to onStateChange subscribers.
 * All timestamps are epoch milliseconds (Date.now()).
 */
export interface HealthState {
  status: HealthStatus
  lastError: string | null
  errorCount: number
  lastSuccessfulConnect: number | null
  nextRetryAt: number | null
  /** Current consecutive reconnect attempt counter. Resets on success. */
  retryAttempt: number
}

export type HealthStateListener = (state: HealthState) => void

// ─── Timing ────────────────────────────────────────────────

/** How often we inspect the underlying connection state. */
const MONITOR_INTERVAL_MS = 30_000

/**
 * Exponential-ish backoff delays (ms) keyed by attempt number (1-based).
 * Attempt >= 5 uses the final MAX_BACKOFF_MS entry.
 */
const BACKOFF_SCHEDULE_MS = [
  1_000,   // Attempt 1
  5_000,   // Attempt 2
  15_000,  // Attempt 3
  60_000,  // Attempt 4
  300_000, // Attempt 5+
] as const

const MAX_BACKOFF_MS = BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]

/**
 * After a successful reconnect, stay in "degraded" for this long if we
 * previously had errors. Gives the user a visible hint that recovery happened.
 */
const DEGRADED_GRACE_MS = 60_000

// ─── Command IDs ───────────────────────────────────────────

const COMMAND_OPEN_ABOUT = "kilo-code.openAbout"
const COMMAND_SETTINGS = "kilo-code.settings"
const COMMAND_RESTART_BACKEND = "kilo-code.v4.restartCliBackend"
const COMMAND_STATUS_BAR_CLICK = "kilo-code.v4.cliBackendStatusBarClick"

// ─── Service ───────────────────────────────────────────────

/**
 * Monitors KiloConnectionService and drives automatic reconnect with
 * exponential backoff. Surfaces human-readable diagnostics for the About
 * page and a status bar item so users can see the CLI backend state at
 * a glance.
 *
 * Wiring contract:
 *   - Construction does not start monitoring on its own. Caller should invoke
 *     start() after the connection service has been initialized.
 *   - dispose() is idempotent and releases timers, the status bar item, and
 *     its connection-service subscription.
 */
export class HealthRecoveryService implements vscode.Disposable {
  private readonly log = KiloLogger.for("CLIHealthRecovery")

  private readonly connectionService: KiloConnectionService
  private readonly context: vscode.ExtensionContext

  private readonly listeners: Set<HealthStateListener> = new Set()
  private readonly disposables: vscode.Disposable[] = []

  private statusBarItem: vscode.StatusBarItem | undefined

  /** Monitor tick timer (30s). */
  private monitorTimer: ReturnType<typeof setInterval> | null = null
  /** Scheduled next-retry timer. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** True while a reconnect call is actually in flight. */
  private reconnectInFlight = false
  /** Tracks whether start() has been called. */
  private started = false
  /** Set once dispose() completes so late callbacks become no-ops. */
  private disposed = false

  // ─── Observable state ────────────────────────────────────

  private status: HealthStatus = "disconnected"
  private lastError: string | null = null
  private errorCount = 0
  private lastSuccessfulConnect: number | null = null
  private nextRetryAt: number | null = null
  private retryAttempt = 0

  constructor(connectionService: KiloConnectionService, context: vscode.ExtensionContext) {
    this.connectionService = connectionService
    this.context = context

    // Subscribe to the underlying connection state immediately so we never miss
    // a transition, but defer timer/status-bar creation until start().
    const unsubscribe = this.connectionService.onStateChange((state) => {
      this.handleConnectionState(state)
    })
    this.disposables.push({ dispose: unsubscribe })

    // Seed from current state — important if construction happens after the
    // connection service has already transitioned.
    const initial = this.connectionService.getConnectionState()
    this.status = this.mapConnectionStateToHealth(initial)
  }

  // ─── Public API ──────────────────────────────────────────

  /**
   * Begin periodic monitoring and register the status bar item. Idempotent.
   * Typically called immediately after the service is constructed.
   */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true

    this.ensureStatusBarItem()
    this.registerStatusBarCommand()
    this.registerRestartCommand()

    this.monitorTimer = setInterval(() => {
      this.runMonitorTick()
    }, MONITOR_INTERVAL_MS)
    this.monitorTimer.unref?.()

    this.log.info("Started — monitoring CLI backend health", { intervalMs: MONITOR_INTERVAL_MS })
    this.refreshStatusBar()
  }

  /** Current status snapshot. */
  getState(): HealthState {
    return {
      status: this.status,
      lastError: this.lastError,
      errorCount: this.errorCount,
      lastSuccessfulConnect: this.lastSuccessfulConnect,
      nextRetryAt: this.nextRetryAt,
      retryAttempt: this.retryAttempt,
    }
  }

  /** Subscribe to state changes. Returns unsubscribe function. */
  onStateChange(callback: HealthStateListener): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * Human-readable diagnostics report suitable for the About page.
   * Multi-line plain text — callers may render as <pre> or split into rows.
   */
  getDiagnostics(): string {
    const info = this.connectionService.getServerInfo()
    const config = this.connectionService.getServerConfig()
    const serverUrl = config?.baseUrl ?? (info ? `http://127.0.0.1:${info.port}` : "(not started)")
    const version = this.context.extension.packageJSON.version ?? "unknown"

    const lines: string[] = []
    lines.push(`CLI Backend Status: ${this.status}`)
    lines.push(`Last connect: ${formatRelativeTime(this.lastSuccessfulConnect)}`)
    lines.push(`Error count: ${this.errorCount}`)
    lines.push(`Server URL: ${serverUrl}`)
    lines.push(`Version: ${version}`)

    if (this.lastError) {
      lines.push(`Last error: ${this.lastError}`)
    }
    if (this.status === "recovering" && this.nextRetryAt) {
      const remaining = Math.max(0, this.nextRetryAt - Date.now())
      lines.push(`Next retry in: ${formatDuration(remaining)}`)
      lines.push(`Retry attempt: ${this.retryAttempt}`)
    }

    return lines.join("\n")
  }

  /**
   * Manual restart trigger. Tears down the current SSE / server via the
   * connection service and forces a reconnect. Intended to be wired to a
   * command or About-page button.
   */
  async restart(): Promise<void> {
    if (this.disposed) return
    this.log.info("Manual restart requested")

    // Clear any pending automatic retry — the manual path takes over.
    this.clearRetryTimer()
    this.retryAttempt = 0
    this.nextRetryAt = null

    this.setStatus("recovering")

    try {
      // Fully tear down the connection service (kills CLI process + SSE),
      // then re-establish via doConnectAttempt() so the normal state flow
      // (connecting → connected) drives our observable state.
      this.connectionService.dispose()
    } catch (err) {
      this.log.warn("Error tearing down connection service during restart", err)
    }

    await this.doConnectAttempt({ manual: true })
  }

  /** Release all resources. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = null
    }
    this.clearRetryTimer()

    for (const d of this.disposables) {
      try {
        d.dispose()
      } catch {
        // swallow — we're tearing down
      }
    }
    this.disposables.length = 0

    this.statusBarItem?.dispose()
    this.statusBarItem = undefined

    this.listeners.clear()
    this.started = false

    this.log.info("Disposed")
  }

  // ─── Connection-state handling ───────────────────────────

  private handleConnectionState(state: ConnectionState): void {
    if (this.disposed) return
    this.log.debug("Underlying connection state changed", { state })

    switch (state) {
      case "connected":
        this.onConnectedSuccess()
        break
      case "connecting":
        // Only flip to "recovering" if we weren't already healthy — avoids
        // flapping the status bar on the very first connect.
        if (this.status !== "healthy") {
          this.setStatus("recovering")
        }
        break
      case "disconnected":
      case "error":
        this.onConnectionLost(state)
        break
    }
  }

  private onConnectedSuccess(): void {
    const hadErrors = this.errorCount > 0
    this.reconnectInFlight = false
    this.retryAttempt = 0
    this.nextRetryAt = null
    this.clearRetryTimer()
    this.lastSuccessfulConnect = Date.now()

    if (hadErrors) {
      // Show degraded for a short grace period so the recovery is visible.
      this.setStatus("degraded")
      setTimeout(() => {
        if (this.disposed) return
        if (this.status === "degraded" && this.connectionService.getConnectionState() === "connected") {
          // Only clear the error counter once the grace window elapses and
          // we're still healthy. Persistent errors should not silently vanish.
          this.errorCount = 0
          this.lastError = null
          this.setStatus("healthy")
        }
      }, DEGRADED_GRACE_MS).unref?.()
    } else {
      this.errorCount = 0
      this.lastError = null
      this.setStatus("healthy")
    }

    this.log.info("CLI backend healthy", {
      serverInfo: this.connectionService.getServerInfo(),
    })
  }

  private onConnectionLost(state: ConnectionState): void {
    const message = state === "error" ? "Connection reported error" : "Connection disconnected"
    this.recordError(message)

    // If we're mid-flight already, let the existing attempt settle.
    if (this.reconnectInFlight) return

    // If a retry is already scheduled, don't double-schedule.
    if (this.retryTimer) {
      this.setStatus("recovering")
      return
    }

    this.scheduleRetry()
  }

  // ─── Monitor loop ────────────────────────────────────────

  private runMonitorTick(): void {
    if (this.disposed) return
    const underlying = this.connectionService.getConnectionState()

    // Sanity-reconcile: if our status says healthy but the underlying service
    // has drifted to disconnected, kick off recovery. This catches cases
    // where we somehow miss a state event.
    if (underlying === "disconnected" || underlying === "error") {
      if (!this.retryTimer && !this.reconnectInFlight) {
        this.log.warn("Monitor tick observed disconnected state — scheduling retry", { underlying })
        this.recordError("Monitor observed disconnected state")
        this.scheduleRetry()
      }
    }

    // Keep the status bar (especially the "next retry in …" tooltip) fresh.
    this.refreshStatusBar()
  }

  // ─── Retry scheduling ────────────────────────────────────

  private scheduleRetry(): void {
    if (this.disposed) return
    if (this.retryTimer) return

    const attempt = this.retryAttempt + 1
    const delay = this.getBackoffDelay(attempt)
    this.retryAttempt = attempt
    this.nextRetryAt = Date.now() + delay

    this.setStatus("recovering")

    this.log.info("Scheduling reconnect", { attempt, delayMs: delay })

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.doConnectAttempt({ manual: false })
    }, delay)
    this.retryTimer.unref?.()
  }

  private getBackoffDelay(attempt: number): number {
    const index = Math.min(attempt - 1, BACKOFF_SCHEDULE_MS.length - 1)
    return BACKOFF_SCHEDULE_MS[index] ?? MAX_BACKOFF_MS
  }

  private async doConnectAttempt(opts: { manual: boolean }): Promise<void> {
    if (this.disposed) return
    if (this.reconnectInFlight) return

    this.reconnectInFlight = true
    this.setStatus("recovering")

    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

    if (!workspaceDir) {
      this.reconnectInFlight = false
      this.recordError("No workspace folder open — cannot reconnect")
      this.log.warn("Reconnect attempt skipped — no workspace folder")
      // Retry later anyway; the user may open a folder soon.
      this.scheduleRetry()
      return
    }

    const endTimer = this.log.time(opts.manual ? "manualReconnect" : "autoReconnect")

    try {
      await this.connectionService.connect(workspaceDir)
      // onConnectedSuccess() will fire via the state listener; nothing else to
      // do here. If connect() resolves but the listener hasn't flipped yet,
      // the next state event will handle it.
      this.log.info("Reconnect attempt completed", { manual: opts.manual })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.recordError(message)
      this.log.error("Reconnect attempt failed", err)
      // Schedule the next attempt. scheduleRetry respects the existing
      // retryAttempt counter so backoff keeps climbing.
      this.reconnectInFlight = false
      this.scheduleRetry()
      return
    } finally {
      endTimer()
    }

    this.reconnectInFlight = false
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.nextRetryAt = null
  }

  // ─── State helpers ───────────────────────────────────────

  private setStatus(next: HealthStatus): void {
    if (this.status === next) {
      this.refreshStatusBar()
      return
    }
    this.status = next
    this.log.debug("Health status changed", { status: next })
    this.refreshStatusBar()
    this.emit()
  }

  private recordError(message: string): void {
    this.errorCount += 1
    this.lastError = message
  }

  private emit(): void {
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (err) {
        this.log.warn("State listener threw", err)
      }
    }
  }

  private mapConnectionStateToHealth(state: ConnectionState): HealthStatus {
    switch (state) {
      case "connected":
        return "healthy"
      case "connecting":
        return "recovering"
      case "error":
      case "disconnected":
      default:
        return "disconnected"
    }
  }

  // ─── Status bar ──────────────────────────────────────────

  private ensureStatusBarItem(): void {
    if (this.statusBarItem) return
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
    this.statusBarItem.name = "KiloCode CLI Backend"
    this.statusBarItem.command = COMMAND_STATUS_BAR_CLICK
    this.statusBarItem.show()
  }

  private registerStatusBarCommand(): void {
    // Silently no-op if the command is already registered (e.g. on reactivation)
    // by wrapping the registration in a try/catch.
    try {
      const disposable = vscode.commands.registerCommand(COMMAND_STATUS_BAR_CLICK, async () => {
        await this.onStatusBarClicked()
      })
      this.disposables.push(disposable)
    } catch (err) {
      this.log.debug("Status bar command already registered", err)
    }
  }

  private registerRestartCommand(): void {
    try {
      const disposable = vscode.commands.registerCommand(COMMAND_RESTART_BACKEND, async () => {
        await this.restart()
      })
      this.disposables.push(disposable)
    } catch (err) {
      this.log.debug("Restart command already registered", err)
    }
  }

  private async onStatusBarClicked(): Promise<void> {
    // Offer different flows based on current state.
    if (this.status === "healthy") {
      await this.openAboutPage()
      return
    }

    const openAbout = "Open About"
    const restart = "Restart CLI Backend"
    const showLogs = "Show Logs"

    const choice = await vscode.window.showInformationMessage(
      `KiloCode CLI Backend: ${this.status}${this.lastError ? ` — ${this.lastError}` : ""}`,
      { modal: false },
      openAbout,
      restart,
      showLogs,
    )

    if (choice === openAbout) {
      await this.openAboutPage()
    } else if (choice === restart) {
      await this.restart()
    } else if (choice === showLogs) {
      KiloLogger.showChannel()
    }
  }

  private async openAboutPage(): Promise<void> {
    // Prefer a dedicated About command if the extension registers one, fall
    // back to opening Settings (which hosts the About tab).
    const allCommands = await vscode.commands.getCommands(true)
    if (allCommands.includes(COMMAND_OPEN_ABOUT)) {
      await vscode.commands.executeCommand(COMMAND_OPEN_ABOUT)
      return
    }
    if (allCommands.includes(COMMAND_SETTINGS)) {
      await vscode.commands.executeCommand(COMMAND_SETTINGS)
      return
    }
    // Last resort — reveal the Output channel so the user at least sees diagnostics.
    KiloLogger.showChannel()
  }

  private refreshStatusBar(): void {
    if (!this.statusBarItem) return

    const { icon, text, tooltip, backgroundColor } = this.describeStatus()
    this.statusBarItem.text = `${icon} ${text}`
    this.statusBarItem.tooltip = tooltip
    this.statusBarItem.backgroundColor = backgroundColor
  }

  private describeStatus(): {
    icon: string
    text: string
    tooltip: string
    backgroundColor: vscode.ThemeColor | undefined
  } {
    const diagnostics = this.getDiagnostics()
    switch (this.status) {
      case "healthy":
        return {
          icon: "$(pass)",
          text: "CLI: healthy",
          tooltip: diagnostics,
          backgroundColor: undefined,
        }
      case "degraded":
        return {
          icon: "$(warning)",
          text: "CLI: degraded",
          tooltip: diagnostics,
          backgroundColor: new vscode.ThemeColor("statusBarItem.warningBackground"),
        }
      case "disconnected":
        return {
          icon: "$(error)",
          text: "CLI: disconnected",
          tooltip: diagnostics,
          backgroundColor: new vscode.ThemeColor("statusBarItem.errorBackground"),
        }
      case "recovering":
      default:
        return {
          icon: "$(sync~spin)",
          text: "CLI: recovering",
          tooltip: diagnostics,
          backgroundColor: new vscode.ThemeColor("statusBarItem.warningBackground"),
        }
    }
  }
}

// ─── Formatting helpers ────────────────────────────────────

function formatRelativeTime(epochMs: number | null): string {
  if (epochMs === null) return "never"
  const diff = Date.now() - epochMs
  if (diff < 0) return "just now"
  return `${formatDuration(diff)} ago`
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"}`
}
