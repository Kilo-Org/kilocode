import { describe, expect, it } from "bun:test"
import {
  dismissNotification,
  fetchAndSendNotifications,
  type NotificationsContext,
} from "../../src/kilo-provider/notifications"

function makeContext(input: { show: boolean; initialDismissed?: string[] }) {
  const flag = new Map<string, unknown>(
    input.initialDismissed ? [["kilo.dismissedNotificationIds", input.initialDismissed]] : [],
  )
  let dismissMobileAppNoticeCalls = 0
  let cached: NotificationsContext["cached"] extends () => infer R ? R : never = null
  const posted: unknown[] = []

  const client = {
    kilo: {
      notifications: async () => ({ data: [] }),
    },
    kilocode: {
      mobileAppNotice: async () => ({ data: { show: input.show } }),
      dismissMobileAppNotice: async () => {
        dismissMobileAppNoticeCalls++
        return { data: true }
      },
    },
  }

  const ctx: NotificationsContext = {
    context: {
      globalState: {
        get: <T>(key: string, fallback?: T) => (flag.has(key) ? (flag.get(key) as T) : fallback),
        update: async (key: string, value: unknown) => {
          flag.set(key, value)
        },
      },
    } as any,
    client: client as any,
    cached: () => cached,
    set: (message) => {
      cached = message
    },
    post: (message) => {
      posted.push(message)
    },
    notify: () => {},
  }

  return { ctx, flag, posted, dismissMobileAppNoticeCallCount: () => dismissMobileAppNoticeCalls }
}

describe("mobile app promo notice", () => {
  it("is included when the local kilo serve reports Cloud Agent usage", async () => {
    const { ctx, posted } = makeContext({ show: true })

    await fetchAndSendNotifications(ctx)

    const message = posted[0] as { notifications: { id: string }[] }
    expect(message.notifications.some((n) => n.id === "mobile-app-promo")).toBe(true)
  })

  it("is omitted for users who have never used a Cloud Agent / remote session", async () => {
    const { ctx, posted } = makeContext({ show: false })

    await fetchAndSendNotifications(ctx)

    const message = posted[0] as { notifications: { id: string }[] }
    expect(message.notifications.some((n) => n.id === "mobile-app-promo")).toBe(false)
  })

  it("persists dismissal in globalState and propagates it to the local kilo serve instance", async () => {
    const { ctx, flag, dismissMobileAppNoticeCallCount } = makeContext({ show: true })

    await fetchAndSendNotifications(ctx)
    await dismissNotification(ctx, "mobile-app-promo")

    expect(flag.get("kilo.dismissedNotificationIds")).toContain("mobile-app-promo")
    expect(dismissMobileAppNoticeCallCount()).toBe(1)
  })

  it("keeps the notice dismissed across subsequent fetches even though the server still reports show=true", async () => {
    const { ctx, posted } = makeContext({ show: true, initialDismissed: ["mobile-app-promo"] })

    await fetchAndSendNotifications(ctx)

    const message = posted[0] as { notifications: { id: string }[]; dismissedIds: string[] }
    expect(message.notifications.some((n) => n.id === "mobile-app-promo")).toBe(true)
    expect(message.dismissedIds).toContain("mobile-app-promo")
  })
})
