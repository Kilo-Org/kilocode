import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

const KEY = "kilo.dismissedNotificationIds"

interface NotificationAction {
  actionText: string
  actionURL: string
}

interface NotificationItem {
  id: string
  title: string
  message: string
  action?: NotificationAction
  showIn?: string[]
  suggestModelId?: string
}

export interface NotificationsMessage {
  type: "notificationsLoaded"
  notifications: NotificationItem[]
  dismissedIds: string[]
}

export interface NotificationsContext {
  context: vscode.ExtensionContext | undefined
  client: KiloClient | null
  cached: () => NotificationsMessage | null
  set: (message: NotificationsMessage) => void
  post: (message: NotificationsMessage) => void
  notify: (id: string) => void
}

const MOBILE_APP_NOTICE_ID = "mobile-app-promo"
const MOBILE_APP_NOTICE_URL = "https://blog.kilo.ai/p/kilo-app-for-ios-and-android-is-live"

/**
 * Purely local (non-server-fetched) notice promoting the Kilo mobile app. Gated by the
 * local `kilo serve` instance's `kilocode.mobileAppNotice()` endpoint, which is only true
 * for users who have previously enabled a Cloud Agent / remote session relay from the CLI
 * (see `Notices.markCloudAgentUsed()` in `packages/opencode/src/kilocode/notices.ts`).
 * Dismissal reuses the existing `kilo.dismissedNotificationIds` globalState flow below.
 */
async function localNotifications(client: KiloClient): Promise<NotificationItem[]> {
  const res = await client.kilocode.mobileAppNotice().catch(() => null)
  if (!res?.data?.show) return []
  return [
    {
      id: MOBILE_APP_NOTICE_ID,
      title: "Kilo Mobile App",
      message: "Continue your /remote sessions in the Kilo mobile app.",
      action: { actionText: "Open", actionURL: MOBILE_APP_NOTICE_URL },
    },
  ]
}

export async function fetchAndSendNotifications(ctx: NotificationsContext): Promise<void> {
  if (!ctx.client) {
    const cached = ctx.cached()
    if (cached) {
      const persisted = ctx.context?.globalState.get<string[]>(KEY, []) ?? []
      const dismissedIds =
        persisted.length > 0 ? Array.from(new Set([...cached.dismissedIds, ...persisted])) : cached.dismissedIds
      const message = { ...cached, dismissedIds }
      if (message !== cached) ctx.set(message)
      ctx.post(message)
    }
    return
  }

  try {
    const [{ data: all }, local] = await Promise.all([
      retry(() => ctx.client!.kilo.notifications(undefined, { throwOnError: true })),
      localNotifications(ctx.client),
    ])
    const notifications = [...local, ...all.filter((n) => !n.showIn || n.showIn.includes("extension"))]
    const existing = ctx.context?.globalState.get<string[]>(KEY, []) ?? []
    const active = new Set(notifications.map((n) => n.id))
    const dismissedIds = notifications.length > 0 ? existing.filter((id) => active.has(id)) : existing
    if (dismissedIds.length !== existing.length) await ctx.context?.globalState.update(KEY, dismissedIds)
    const message = { type: "notificationsLoaded" as const, notifications, dismissedIds }
    ctx.set(message)
    ctx.post(message)
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch notifications:", error)
  }
}

export async function dismissNotification(ctx: NotificationsContext, id: string): Promise<void> {
  if (!ctx.context) return
  const existing = ctx.context.globalState.get<string[]>(KEY, [])
  if (!existing.includes(id)) await ctx.context.globalState.update(KEY, [...existing, id])

  // Also persist dismissal on the local kilo serve instance so the CLI/TUI (which shares
  // the same machine-global notice flag) stops showing it too.
  if (id === MOBILE_APP_NOTICE_ID) await ctx.client?.kilocode.dismissMobileAppNotice().catch(() => undefined)

  const cached = ctx.cached()
  if (cached && !cached.dismissedIds.includes(id)) {
    ctx.set({
      ...cached,
      dismissedIds: [...cached.dismissedIds, id],
    })
  }

  await fetchAndSendNotifications(ctx)
  ctx.notify(id)
}

export async function resetReadNotifications(ctx: NotificationsContext): Promise<void> {
  await ctx.context?.globalState.update(KEY, undefined)
  await fetchAndSendNotifications(ctx)
  vscode.window.showInformationMessage("Read notifications have been reset.")
}
