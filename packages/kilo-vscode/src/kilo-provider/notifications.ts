import * as vscode from "vscode"
import type { KiloClient, KiloNotificationsResponse } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

const KEY = "kilo.dismissedNotificationIds"

type Notification = KiloNotificationsResponse[number]

type Message = {
  type: "notificationsLoaded"
  notifications: Notification[]
  dismissedIds: string[]
}

export type NotificationContext = {
  client: () => KiloClient | null
  state: () => vscode.Memento | undefined
  post: (msg: unknown) => void
  notify: (id: string) => void
}

export class NotificationController {
  private cached: Message | null = null

  constructor(private readonly ctx: NotificationContext) {}

  async fetch(): Promise<void> {
    const client = this.ctx.client()
    if (!client) {
      if (this.cached) {
        const persisted = this.ctx.state()?.get<string[]>(KEY, []) ?? []
        if (persisted.length > 0) {
          this.cached = {
            ...this.cached,
            dismissedIds: merge(this.cached.dismissedIds, persisted),
          }
        }
        this.ctx.post(this.cached)
      }
      return
    }

    try {
      const { data: all } = await retry(() => client.kilo.notifications(undefined, { throwOnError: true }))
      const notifications = all.filter((n) => !n.showIn || n.showIn.includes("extension"))
      const existing = this.ctx.state()?.get<string[]>(KEY, []) ?? []
      const active = new Set(notifications.map((n) => n.id))
      // Only prune stale dismissed IDs when we have a non-empty notification
      // list. An empty list may mean the API returned nothing due to being
      // unauthenticated (e.g. right after logout), not that all notifications
      // are gone. Pruning in that case would wipe the persisted dismissals.
      const dismissedIds = notifications.length > 0 ? existing.filter((id) => active.has(id)) : existing
      if (dismissedIds.length !== existing.length) {
        await this.ctx.state()?.update(KEY, dismissedIds)
      }
      this.cached = { type: "notificationsLoaded", notifications, dismissedIds }
      this.ctx.post(this.cached)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch notifications:", error)
    }
  }

  async dismiss(id: string): Promise<void> {
    const state = this.ctx.state()
    if (!state) return

    const existing = state.get<string[]>(KEY, [])
    if (!existing.includes(id)) {
      await state.update(KEY, [...existing, id])
    }

    if (this.cached && !this.cached.dismissedIds.includes(id)) {
      this.cached = {
        ...this.cached,
        dismissedIds: [...this.cached.dismissedIds, id],
      }
    }

    await this.fetch()
    this.ctx.notify(id)
  }

  sendSettings(): void {
    const notifications = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    this.ctx.post({
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

function merge(existing: string[], persisted: string[]) {
  return Array.from(new Set([...existing, ...persisted]))
}
