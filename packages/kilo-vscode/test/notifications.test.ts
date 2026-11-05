import { describe, expect, it } from "bun:test"
import { stripSubProviderPrefix } from "../webview-ui/src/components/shared/model-selector-filter"
import { visibleNotifications } from "../webview-ui/src/v2/notification-list"
import { dismissNotification, dismissedNotifications, syncDismissedNotifications } from "../src/notifications"

function memory(initial: string[] = []) {
  let stored = initial
  const writes: string[][] = []
  return {
    writes,
    read: () => stored,
    external: (ids: string[]) => {
      stored = ids
    },
    globalState: {
      get<T>(_key: string, fallback: T) {
        return (stored.length ? stored : fallback) as T
      },
      async update(_key: string, value: string[]) {
        // A delayed write models globalState, which is asynchronous in the extension host.
        await Promise.resolve()
        stored = value
        writes.push([...value])
      },
    },
  }
}

describe("kilo notifications", () => {
  it("keeps extension notices and hides dismissed and other surfaces", () => {
    const items = [
      { id: "kilo.cli", title: "Kilo CLI", message: "Install the CLI", showIn: ["extension"] },
      { id: "kilo.dismissed", title: "Old", message: "Already read", showIn: ["extension"] },
      { id: "kilo.web", title: "Cloud", message: "Web only", showIn: ["web"] },
      { id: "kilo.everywhere", title: "All", message: "Every surface" },
    ]

    expect(visibleNotifications(items, ["kilo.dismissed"])).toEqual([items[0], items[3]])
  })

  it("shows the model name without the upstream provider prefix", () => {
    expect(stripSubProviderPrefix("MiniMax: MiniMax M2")).toBe("MiniMax M2")
    expect(stripSubProviderPrefix("Kilo: Auto")).toBe("Kilo: Auto")
    expect(stripSubProviderPrefix("Auto")).toBe("Auto")
  })

  it("persists dismissals once and prunes IDs the Gateway stopped sending", async () => {
    const store = memory(["kilo.old", "kilo.kept"])

    expect(dismissedNotifications(store)).toEqual(["kilo.old", "kilo.kept"])
    expect(dismissNotification(store, "kilo.new")).toEqual(["kilo.old", "kilo.kept", "kilo.new"])
    expect(dismissNotification(store, "kilo.new")).toEqual(["kilo.old", "kilo.kept", "kilo.new"])

    await Bun.sleep(0)
    expect(store.writes.length).toBe(1)

    expect(syncDismissedNotifications(store, ["kilo.kept", "kilo.new"])).toEqual(["kilo.kept", "kilo.new"])
    expect(syncDismissedNotifications(store, ["kilo.new"])).toEqual(["kilo.new"])

    await Bun.sleep(0)
    expect(store.read()).toEqual(["kilo.new"])
    expect(store.writes.length).toBe(3)
    expect(store.writes.at(-1)).toEqual(["kilo.new"])
  })

  it("keeps dismissals when the active list is empty", async () => {
    const store = memory(["kilo.a", "kilo.b"])

    expect(syncDismissedNotifications(store, [])).toEqual(["kilo.a", "kilo.b"])

    await Bun.sleep(0)
    expect(store.read()).toEqual(["kilo.a", "kilo.b"])
    expect(store.writes.length).toBe(0)
  })

  it("merges dismissals another window wrote to globalState", async () => {
    const store = memory()

    dismissNotification(store, "kilo.a")
    await Bun.sleep(0)
    store.external(["kilo.a", "kilo.b"])

    expect(dismissNotification(store, "kilo.c")).toEqual(["kilo.a", "kilo.b", "kilo.c"])
    await Bun.sleep(0)
    expect(store.read()).toEqual(["kilo.a", "kilo.b", "kilo.c"])
  })

  it("keeps every ID when Close dismisses several in one tick", async () => {
    const store = memory()

    dismissNotification(store, "kilo.a")
    dismissNotification(store, "kilo.b")
    dismissNotification(store, "kilo.c")

    await Bun.sleep(0)
    expect(store.read()).toEqual(["kilo.a", "kilo.b", "kilo.c"])
    expect(store.writes.at(-1)).toEqual(["kilo.a", "kilo.b", "kilo.c"])
  })
})
