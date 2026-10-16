import { describe, expect, it } from "bun:test"
import { dismissNotification, fetchAndSendNotifications } from "../../src/kilo-provider/notifications"

const KEY = "kilo.dismissedNotificationIds"

describe("KiloProvider local notifications", () => {
  it("passes local notifications through without requiring a profile", async () => {
    const items = [
      {
        id: "kilo.local.claude-migration",
        title: "Claude Code migration",
        message: "Migration details",
        showIn: ["extension"],
      },
      {
        id: "kilo.local.claude-migration-partial",
        title: "Claude Code migration",
        message: "Some items were skipped",
        showIn: ["extension"],
      },
      {
        id: "cloud-only",
        title: "Cloud notice",
        message: "Cloud-only",
        showIn: ["web"],
      },
    ]
    const state = new Map<string, unknown>([[KEY, [items[0].id]]])
    const sent: unknown[] = []
    const notified: string[] = []
    const messages: Array<{ notifications: typeof items; dismissedIds: string[] }> = []
    const ctx = {
      context: {
        globalState: {
          get: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
          update: async (key: string, value: unknown) => {
            state.set(key, value)
          },
        },
      },
      client: {
        kilo: {
          notifications: async () => ({ data: items }),
        },
      },
      cached: () => null,
      set: (message: { notifications: typeof items; dismissedIds: string[] }) => messages.push(message),
      post: (message: unknown) => sent.push(message),
      notify: (id: string) => notified.push(id),
    }

    await fetchAndSendNotifications(ctx as never)

    expect(messages[0]).toEqual({
      type: "notificationsLoaded",
      notifications: items.slice(0, 2),
      dismissedIds: [items[0].id],
    })
    expect(sent).toHaveLength(1)
    expect(state.get(KEY)).toEqual([items[0].id])

    await dismissNotification(ctx as never, items[1].id)

    expect(state.get(KEY)).toEqual([items[0].id, items[1].id])
    expect(notified).toEqual([items[1].id])
  })
})
