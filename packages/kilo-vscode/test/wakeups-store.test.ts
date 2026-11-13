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

function scene(input: { now?: number; sessions?: Pending[]; unavailable?: boolean; home?: string } = {}) {
  const handler: { current?: (event: { data: Pending }) => void } = {}
  const calls: Array<{ directory: string; location: string }> = []
  const rpc = {
    pending: async (value: { directory: string }, options: { location: { directory: string } }) => {
      calls.push({ directory: value.directory, location: options.location.directory })
      if (input.unavailable) throw { type: "rpc.unavailable", message: "no plugin" }
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
  const api = { rpc: () => rpc } as unknown as OpenCodeClient
  const [connected, setConnected] = createSignal(true)
  const [directories, setDirectories] = createSignal<readonly string[]>(["/repo"])
  const wakeups = createRoot((dispose) => ({
    dispose,
    value: createWakeups({ api, directories, connected, home: input.home ? () => input.home : undefined }),
    connect: (value: boolean) => setConnected(value),
    show: (value: readonly string[]) => setDirectories(value),
    emit: (data: Pending) => handler.current?.({ data }),
  }))
  return { ...wakeups, calls, setConnected, setDirectories }
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
})
