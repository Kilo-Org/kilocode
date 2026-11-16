import { describe, expect, mock, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"

const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [() => T, (value: T) => void]
}
const { createWakeups } = await import("../webview-ui/src/v2/wakeups")

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

type Pending = { sessionID: string; directory: string; pending: number; dueAt?: number }

async function until(check: () => boolean, timeout = 2_000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await Bun.sleep(10)) if (check()) return
  throw new Error("condition not reached")
}

/**
 * `plugins` answers each inventory read of a Location that starts cold: the wakeup RPC is unavailable until a read
 * lists a plugin, as on a real server. Without it the Location has its plugins from the start. `unavailable` is a
 * server without the wakeup plugin.
 */
function scene(
  input: {
    now?: number
    sessions?: Pending[]
    unavailable?: boolean
    home?: string
    plugins?: (call: number) => unknown[]
  } = {},
) {
  const handler: { current?: (event: { data: Pending }) => void } = {}
  const calls: Array<{ directory: string; location: string }> = []
  const lists: string[] = []
  const state = { listed: !input.plugins }
  const rpc = {
    pending: async (value: { directory: string }, options: { location: { directory: string } }) => {
      calls.push({ directory: value.directory, location: options.location.directory })
      if (input.unavailable || !state.listed) throw { type: "rpc.unavailable", message: "no plugin" }
      return { sessions: input.sessions ?? [] }
    },
    events: {
      on: (_name: string, callback: (event: { data: Pending }) => void) => {
        handler.current = callback
        return () => {
          handler.current = undefined
        }
      },
    },
  }
  const plugin = {
    list: async (options: { location: { directory: string } }) => {
      lists.push(options.location.directory)
      const data = input.plugins?.(lists.length) ?? [{ id: "opencode.plan" }]
      state.listed = data.length > 0
      return { data }
    },
  }
  const api = { rpc: () => rpc, plugin } as unknown as OpenCodeClient
  const [connected, setConnected] = createSignal(true)
  const [directories, setDirectories] = createSignal<readonly string[]>(["/repo"])
  const wakeups = createRoot((dispose) => ({
    dispose,
    value: createWakeups({ api, directories, connected, home: input.home ? () => input.home : undefined }),
    connect: (value: boolean) => setConnected(value),
    show: (value: readonly string[]) => setDirectories(value),
    emit: (data: Pending) => handler.current?.({ data }),
  }))
  return { ...wakeups, calls, lists, setConnected, setDirectories }
}

describe("wakeup store", () => {
  test("asks the home Location for every directory", async () => {
    const app = scene({ home: "/repo" })
    app.show(["/repo", "/repo/.kilo/worktrees/a", "/repo/.kilo/worktrees/b"])
    await tick()
    expect(app.calls).toEqual([
      { directory: "/repo", location: "/repo" },
      { directory: "/repo/.kilo/worktrees/a", location: "/repo" },
      { directory: "/repo/.kilo/worktrees/b", location: "/repo" },
    ])
    app.dispose()
  })

  test("asks each directory itself without a home", async () => {
    const app = scene()
    await tick()
    expect(app.calls).toEqual([{ directory: "/repo", location: "/repo" }])
    app.dispose()
  })

  test("seeds the pending sessions of a directory", async () => {
    const now = Date.now()
    const app = scene({ sessions: [{ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: now + 60_000 }] })
    await tick()
    expect(app.value.scheduled("ses_a")).toBe(true)
    expect(app.value.scheduled("ses_b")).toBe(false)
    app.dispose()
  })

  test("a changed event adds and removes a session", async () => {
    const app = scene()
    await tick()
    expect(app.value.scheduled("ses_a")).toBe(false)

    app.emit({ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: Date.now() + 60_000 })
    expect(app.value.scheduled("ses_a")).toBe(true)

    app.emit({ sessionID: "ses_a", directory: "/repo", pending: 0 })
    expect(app.value.scheduled("ses_a")).toBe(false)
    app.dispose()
  })

  test("a passed due time stops reporting scheduled", async () => {
    const app = scene()
    await tick()
    app.emit({ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: Date.now() - 1_000 })
    expect(app.value.scheduled("ses_a")).toBe(false)
    app.dispose()
  })

  test("a reconnect clears what an offline event could have missed", async () => {
    const app = scene()
    await tick()
    app.emit({ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: Date.now() + 60_000 })
    expect(app.value.scheduled("ses_a")).toBe(true)

    app.connect(false)
    expect(app.value.scheduled("ses_a")).toBe(false)
    app.connect(true)
    await tick()
    expect(app.value.scheduled("ses_a")).toBe(false)
    app.dispose()
  })

  test("a directory added later is seeded", async () => {
    const now = Date.now()
    const app = scene({ sessions: [{ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: now + 60_000 }] })
    await tick()
    app.setDirectories(["/repo", "/worktree"])
    await tick()
    expect(app.value.scheduled("ses_a")).toBe(true)
    app.dispose()
  })

  test("a server without the plugin keeps every session idle", async () => {
    const app = scene({ unavailable: true })
    await tick()
    app.emit({ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: Date.now() + 60_000 })
    expect(app.value.scheduled("ses_a")).toBe(true)
    app.connect(false)
    app.connect(true)
    await tick()
    // Seeding was refused, so the map stays empty rather than reporting a failure on every connect.
    expect(app.value.scheduled("ses_a")).toBe(false)
    app.dispose()
  })

  test("a Location that is still activating is seeded once it lists its plugins", async () => {
    const now = Date.now()
    const app = scene({
      home: "/home",
      sessions: [{ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: now + 60_000 }],
      plugins: (call) => (call < 3 ? [] : [{ id: "kilocode.wakeup" }]),
    })
    try {
      await until(() => app.value.scheduled("ses_a"))
      // The inventory is read from the Location that answers, and the directory is asked again once it is listed.
      expect(app.lists).toEqual(["/home", "/home", "/home"])
      expect(app.calls).toEqual([
        { directory: "/repo", location: "/home" },
        { directory: "/repo", location: "/home" },
      ])
    } finally {
      app.dispose()
    }
  })

  test("a server that lists its plugins without the wakeup plugin is asked twice and then left alone", async () => {
    const app = scene({ unavailable: true })
    try {
      await until(() => app.calls.length === 2)
      await Bun.sleep(300)
      expect(app.calls).toHaveLength(2)
      expect(app.lists).toHaveLength(1)

      // The refusal holds for the connection: a directory added later is not asked.
      app.setDirectories(["/repo", "/worktree"])
      await Bun.sleep(50)
      expect(app.calls).toHaveLength(2)
    } finally {
      app.dispose()
    }
  })

  test("a connection that drops while the Location activates ends the wait, and the next one seeds again", async () => {
    const now = Date.now()
    const state = { cold: true }
    const app = scene({
      sessions: [{ sessionID: "ses_a", directory: "/repo", pending: 1, dueAt: now + 60_000 }],
      plugins: () => (state.cold ? [] : [{ id: "kilocode.wakeup" }]),
    })
    try {
      await until(() => app.lists.length >= 2)
      app.connect(false)
      await Bun.sleep(150)
      const settled = app.lists.length
      await Bun.sleep(300)
      expect(app.lists).toHaveLength(settled)
      expect(app.calls).toHaveLength(1)

      state.cold = false
      app.connect(true)
      await until(() => app.value.scheduled("ses_a"))
    } finally {
      app.dispose()
    }
  })

  test("a disposed owner ends the wait for a Location that is still activating", async () => {
    const app = scene({ plugins: () => [] })
    await until(() => app.lists.length >= 2)
    app.dispose()
    await Bun.sleep(150)
    const settled = app.lists.length
    await Bun.sleep(300)
    expect(app.lists).toHaveLength(settled)
    expect(app.calls).toHaveLength(1)
  })
})
