import * as vscode from "vscode"
import type { HermesClient } from "./HermesClient"
import {
  HERMES_CFG_SECTION,
  HERMES_DEFAULT_BASE_URL,
  type ApprovalMode,
  type HermesConfig,
} from "./types"

type Listener = (cfg: HermesConfig, reachable: boolean) => void

/**
 * Owns the Hermes status bar item, the enabled/disabled toggle, and periodic
 * bridge-reachability pings. Mirrors the RemoteStatusService pattern.
 *
 * When `enabled === false` the status bar is hidden and no pings run —
 * zero cost for users who never turn the pipeline on.
 */
export class HermesStatusService implements vscode.Disposable {
  private readonly bar: vscode.StatusBarItem
  private readonly listeners = new Set<Listener>()
  private reachable = false
  private timer: ReturnType<typeof setInterval> | undefined
  private client: HermesClient | undefined

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
    this.bar.command = "kilo-code.new.hermes.toggle"
    this.sync()

    // React to settings changes (enabled / baseUrl / approvalMode).
    const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(HERMES_CFG_SECTION)) return
      this.rewire()
    })
    ctx.subscriptions.push(watcher)
    this.rewire()
  }

  setClient(c: HermesClient): void {
    this.client = c
    c.setConfig(this.getConfig())
    this.rewire()
  }

  /** Read the current config from VS Code settings. */
  getConfig(): HermesConfig {
    const cfg = vscode.workspace.getConfiguration(HERMES_CFG_SECTION)
    return {
      enabled: cfg.get<boolean>("enabled", false),
      baseUrl: cfg.get<string>("baseUrl", HERMES_DEFAULT_BASE_URL).trim() || HERMES_DEFAULT_BASE_URL,
      approvalMode: cfg.get<ApprovalMode>("approvalMode", "auto-low"),
      workspaceScopeOnly: cfg.get<boolean>("workspaceScopeOnly", true),
    }
  }

  /** Is the bridge currently reachable? (always false when disabled). */
  isReachable(): boolean {
    return this.reachable
  }

  /** Toggle enabled/disabled. Persists to the global settings scope. */
  async toggle(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(HERMES_CFG_SECTION)
    const next = !cfg.get<boolean>("enabled", false)
    await cfg.update("enabled", next, vscode.ConfigurationTarget.Global)
    vscode.window.showInformationMessage(
      next ? "Hermes pipeline enabled" : "Hermes pipeline disabled",
    )
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Force a one-shot health refresh. */
  async refresh(): Promise<void> {
    if (!this.client) return
    const cfg = this.getConfig()
    if (!cfg.enabled) {
      this.update(cfg, false)
      return
    }
    const res = await this.client.health()
    this.update(cfg, res.bridge_reachable && res.ok)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.listeners.clear()
    this.bar.dispose()
  }

  // -- internal ---------------------------------------------------------------

  private rewire(): void {
    const cfg = this.getConfig()
    if (this.client) this.client.setConfig(cfg)

    if (!cfg.enabled) {
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = undefined
      }
      this.update(cfg, false)
      return
    }

    // Enabled — start the ping loop if not running.
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.refresh()
      }, 30_000)
    }
    void this.refresh()
  }

  private update(cfg: HermesConfig, reachable: boolean): void {
    this.reachable = reachable
    this.sync(cfg, reachable)
    for (const cb of this.listeners) cb(cfg, reachable)
  }

  private sync(cfg?: HermesConfig, reachable = this.reachable): void {
    const current = cfg ?? this.getConfig()
    if (!current.enabled) {
      this.bar.hide()
      return
    }
    if (reachable) {
      this.bar.text = "$(globe) Hermes"
      this.bar.tooltip = `Hermes pipeline online — ${current.baseUrl}`
      this.bar.color = new vscode.ThemeColor("testing.iconPassed")
    } else {
      this.bar.text = "$(globe) Hermes \u2026"
      this.bar.tooltip = `Hermes pipeline unreachable — ${current.baseUrl}`
      this.bar.color = new vscode.ThemeColor("editorWarning.foreground")
    }
    this.bar.show()
  }
}
