/**
 * Notification handlers — extracted from KiloProvider.
 *
 * Owns the notification fetch/dismiss/settings flow for a single KiloProvider
 * instance. Each instance holds its own NotificationHandler so the cached
 * message and dismiss state stay scoped to that webview.
 *
 * Ownership:
 * - Gateway fetch + showIn filter for this client (kilocode-vscode-extension)
 * - Cached `notificationsLoaded` payload so a webview refresh gets data without waiting for a round-trip
 * - Dismiss persistence in globalState under `kilo.dismissedNotificationIds`
 * - Cross-instance dismiss sync via `KiloConnectionService.onNotificationDismissed`
 * - Notification/sound setting bridge (`kilo-code.new.notifications`, `kilo-code.new.sounds`)
 */
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../../services/cli-backend/retry"

const DISMISSED_IDS_KEY = "kilo.dismissedNotificationIds"

export interface NotificationContext {
  readonly client: KiloClient | null
  readonly extensionContext: vscode.ExtensionContext | undefined
  readonly connectionService: {
    onNotificationDismissed(listener: (id: string) => void): () => void
    notifyNotificationDismissed(id: string): void
  }
  postMessage(msg: unknown): void
}

interface CachedNotifications {
  type: "notificationsLoaded"
  notifications: unknown[]
  dismissedIds: string[]
}

export class NotificationHandler {
  private cached: CachedNotifications | null = null
  private unsubscribeDismiss: (() => void) | null = null

  constructor(private readonly ctx: NotificationContext) {}

  /** Subscribe to cross-instance dismiss broadcasts. Safe to call multiple times. */
  subscribe(): void {
    this.unsubscribeDismiss?.()
    this.unsubscribeDismiss = this.ctx.connectionService.onNotificationDismissed(() => {
      void this.fetchAndSend()
    })
  }

  dispose(): void {
    this.unsubscribeDismiss?.()
    this.unsubscribeDismiss = null
  }

  /** Drop the cached payload (used when clearing state). */
  clearCache(): void {
    this.cached = null
  }

  /**
   * Fetch notifications from the Kilo gateway and push to the webview.
   * Uses the cached message pattern so the webview gets data immediately on refresh.
   */
  async fetchAndSend(): Promise<void> {
    const ctx = this.ctx
    if (!ctx.client) {
      if (!this.cached) return
      // Merge the latest dismissed IDs from globalState into the cached
      // message so that dismissals persisted while offline are honoured.
      const persisted = ctx.extensionContext?.globalState.get<string[]>(DISMISSED_IDS_KEY, []) ?? []
      if (persisted.length > 0) {
        const merged = Array.from(new Set([...this.cached.dismissedIds, ...persisted]))
        this.cached = { ...this.cached, dismissedIds: merged }
      }
      ctx.postMessage(this.cached)
      return
    }

    try {
      const { data: all } = await retry(() => ctx.client!.kilo.notifications(undefined, { throwOnError: true }))
      const notifications = all.filter(
        (n) => !n.showIn || n.showIn.includes("extension") || n.showIn.includes("kilocode-vscode-extension"),
      )
      const existing = ctx.extensionContext?.globalState.get<string[]>(DISMISSED_IDS_KEY, []) ?? []
      const active = new Set(notifications.map((n) => n.id))
      // Only prune stale dismissed IDs when we have a non-empty notification
      // list. An empty list may mean the API returned nothing due to being
      // unauthenticated (e.g. right after logout), not that all notifications
      // are gone — pruning in that case would wipe the persisted dismissals.
      const dismissedIds = notifications.length > 0 ? existing.filter((id) => active.has(id)) : existing
      if (dismissedIds.length !== existing.length) {
        await ctx.extensionContext?.globalState.update(DISMISSED_IDS_KEY, dismissedIds)
      }
      const message: CachedNotifications = { type: "notificationsLoaded", notifications, dismissedIds }
      this.cached = message
      ctx.postMessage(message)
    } catch (err) {
      console.error("[Kilo New] NotificationHandler: Failed to fetch notifications:", err)
    }
  }

  /**
   * Persist a dismissed notification ID in globalState and push updated lists to webview.
   * Also broadcasts to other KiloProvider instances via the connection service.
   */
  async dismiss(id: string): Promise<void> {
    const ctx = this.ctx
    if (!ctx.extensionContext) return
    const existing = ctx.extensionContext.globalState.get<string[]>(DISMISSED_IDS_KEY, [])
    if (!existing.includes(id)) {
      await ctx.extensionContext.globalState.update(DISMISSED_IDS_KEY, [...existing, id])
    }
    // Update the cached message so the dismiss persists even if
    // fetchAndSend() fails (e.g. no client / API error).
    if (this.cached && !this.cached.dismissedIds.includes(id)) {
      this.cached = { ...this.cached, dismissedIds: [...this.cached.dismissedIds, id] }
    }
    await this.fetchAndSend()
    ctx.connectionService.notifyNotificationDismissed(id)
  }

  /** Clear the persisted dismissed-ID list. Used by reset-all-settings. */
  async clearDismissed(): Promise<void> {
    await this.ctx.extensionContext?.globalState.update(DISMISSED_IDS_KEY, undefined)
  }

  /** Read notification/sound settings from VS Code config and push to webview. */
  sendSettings(): void {
    const notifications = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    this.ctx.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        notifyAgent: notifications.get<boolean>("agent", true),
        notifyPermissions: notifications.get<boolean>("permissions", true),
        notifyErrors: notifications.get<boolean>("errors", true),
        soundAgent: sounds.get<string>("agent", "default"),
        soundPermissions: sounds.get<string>("permissions", "default"),
        soundErrors: sounds.get<string>("errors", "default"),
      },
    })
  }
}
