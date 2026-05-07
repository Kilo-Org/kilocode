import { describe, expect, it } from "bun:test"
import { NotificationController } from "../../src/kilo-provider/notifications"

const KEY = "kilo.dismissedNotificationIds"
const noop = () => undefined

type Item = {
  id: string
  title?: string
  message?: string
  showIn?: string[]
}

function note(item: Item) {
  return {
    title: item.title ?? item.id,
    message: item.message ?? item.id,
    ...item,
  }
}

function state(initial: string[] = []) {
  const updates: Array<string[] | undefined> = []
  const store = new Map<string, unknown>([[KEY, initial]])
  return {
    updates,
    memento: {
      get: <T>(_key: string, fallback?: T) => (store.has(KEY) ? store.get(KEY) : fallback) as T,
      update: async (_key: string, value: string[] | undefined) => {
        updates.push(value)
        if (value === undefined) {
          store.delete(KEY)
          return
        }
        store.set(KEY, value)
      },
    },
  }
}

function client(items: ReturnType<typeof note>[]) {
  return {
    kilo: {
      notifications: async () => ({ data: items }),
    },
  }
}

describe("NotificationController", () => {
  it("serves cached notifications when client is unavailable", async () => {
    const posted: unknown[] = []
    const ctx = state(["persisted"])
    const ref = { client: client([note({ id: "active" })]) as never }
    const ctrl = new NotificationController({
      client: () => ref.client,
      state: () => ctx.memento as never,
      post: (msg) => posted.push(msg),
      notify: noop,
    })

    await ctrl.fetch()
    ref.client = null as never
    await ctrl.fetch()

    expect(posted).toHaveLength(2)
    expect(posted[1]).toEqual({
      type: "notificationsLoaded",
      notifications: [note({ id: "active" })],
      dismissedIds: [],
    })
  })

  it("merges persisted dismissed IDs into cached fallback", async () => {
    const posted: unknown[] = []
    const ctx = state([])
    const ref = { client: client([note({ id: "active" })]) as never }
    const ctrl = new NotificationController({
      client: () => ref.client,
      state: () => ctx.memento as never,
      post: (msg) => posted.push(msg),
      notify: noop,
    })

    await ctrl.fetch()
    await ctx.memento.update(KEY, ["active", "offline"])
    ref.client = null as never
    await ctrl.fetch()

    expect(posted[1]).toEqual({
      type: "notificationsLoaded",
      notifications: [note({ id: "active" })],
      dismissedIds: ["active", "offline"],
    })
  })

  it("prunes stale dismissed IDs only when active notifications are non-empty", async () => {
    const ctx = state(["keep", "stale"])
    const ctrl = new NotificationController({
      client: () => client([note({ id: "keep" }), note({ id: "hidden", showIn: ["web"] })]) as never,
      state: () => ctx.memento as never,
      post: noop,
      notify: noop,
    })

    await ctrl.fetch()
    expect(ctx.updates).toEqual([["keep"]])

    const empty = state(["keep", "stale"])
    const emptyCtrl = new NotificationController({
      client: () => client([]) as never,
      state: () => empty.memento as never,
      post: noop,
      notify: noop,
    })

    await emptyCtrl.fetch()
    expect(empty.updates).toEqual([])
  })

  it("dismisses by persisting state, updating cache, fetching, then broadcasting", async () => {
    const calls: string[] = []
    const ctx = state([])
    const ref = { client: client([note({ id: "n1" })]) as never }
    const ctrl = new NotificationController({
      client: () => ref.client,
      state: () => ({
        get: ctx.memento.get,
        update: async (key: string, value: string[] | undefined) => {
          calls.push(`persist:${value?.join(",") ?? "undefined"}`)
          await ctx.memento.update(key, value)
        },
      }) as never,
      post: (msg) => {
        const posted = msg as { dismissedIds: string[] }
        calls.push(`post:${posted.dismissedIds.join(",")}`)
      },
      notify: (id) => calls.push(`notify:${id}`),
    })

    await ctrl.fetch()
    calls.length = 0
    ref.client = null as never
    await ctrl.dismiss("n1")
    expect(calls).toEqual(["persist:n1", "post:n1", "notify:n1"])
  })
})
