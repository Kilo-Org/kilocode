import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { t } from "./cli-backend/i18n"

export type RemoteState = { enabled: boolean; connected: boolean }

type Listener = (state: RemoteState) => void

/**
 * Singleton service that owns all remote-control state and the VS Code status bar item.
 * Replaces the per-webview polling in RemoteIndicator.tsx and ExperimentalTab.tsx
 * with a push-based model: one status bar item, zero recurring cost for non-remote users.
 */
export class RemoteStatusService implements vscode.Disposable {
  private state: RemoteState = { enabled: false, connected: false }
  private bar: vscode.StatusBarItem
  private listeners = new Set<Listener>()
  private client: KiloClient | null = null

  constructor() {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    this.bar.command = "kilo-code.new.toggleRemote"
    this.sync()
  }

  setClient(c: KiloClient | null): void {
    this.client = c
  }

  /** Get current state synchronously. */
  getState(): RemoteState {
    return this.state
  }

  updateFromEvent(state: RemoteState): void {
    this.update(state)
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  clearState(): void {
    this.update({ enabled: false, connected: false })
  }

  /** One-shot status fetch — broadcasts via onChange if state changed. */
  async refresh(): Promise<void> {
    if (!this.client) return
    const res = await this.client.remote.status().catch((err: unknown) => {
      console.warn("[Kilo] remote status refresh failed:", err)
      return undefined
    })
    if (!res?.data) return
    this.update({ enabled: res.data.enabled, connected: res.data.connected })
  }

  /** Toggle remote on/off based on current state. */
  async toggle(): Promise<void> {
    if (!this.client) return
    const { data } = await this.client.remote.status(undefined, { throwOnError: true })
    await this.setEnabled(!data.enabled)
  }

  /** Enable or disable remote. State updates are pushed via events. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.client) return
    if (enabled) {
      await this.client.remote.enable(undefined, { throwOnError: true })
    } else {
      await this.client.remote.disable(undefined, { throwOnError: true })
    }
    this.update({ enabled, connected: false })
  }

  /**
   * Handle a remote-related webview message.
   * Returns a response message to post back to the webview, or null.
   */
  async handleMessage(type: string, enabled?: boolean): Promise<RemoteState | null> {
    switch (type) {
      case "toggleRemote":
        await this.toggle()
        return null
      case "setRemoteEnabled":
        if (enabled === undefined) return null
        await this.setEnabled(enabled)
        return null
      case "requestRemoteStatus":
        void this.refresh()
        return this.state
    }
    return null
  }

  dispose(): void {
    this.listeners.clear()
    this.bar.dispose()
  }

  // -- internal ---------------------------------------------------------------

  private update(next: RemoteState): void {
    if (this.state.enabled === next.enabled && this.state.connected === next.connected) return
    this.state = next
    this.sync()
    for (const cb of this.listeners) cb(next)
  }

  /** Sync status bar appearance to current state. */
  private sync(): void {
    if (!this.state.enabled) {
      this.bar.hide()
      return
    }
    if (this.state.connected) {
      this.bar.text = "$(radio-tower) Kilo Remote"
      this.bar.tooltip = t("remote.connected")
      this.bar.color = new vscode.ThemeColor("testing.iconPassed")
    } else {
      this.bar.text = "$(radio-tower) Kilo Remote \u2026"
      this.bar.tooltip = t("remote.connecting")
      this.bar.color = new vscode.ThemeColor("editorWarning.foreground")
    }
    this.bar.show()
  }
}
