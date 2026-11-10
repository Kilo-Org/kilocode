import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { createRoot, createSignal } from "solid-js"
import { busy, trackBusy } from "../../src/kilocode/caffeinate"

type Data = Plugin.Context["data"]
type Scene = {
  sessions?: string[]
  status?: Record<string, "idle" | "running">
  pending?: Record<string, Array<{ type: string }>>
}

function data(scene: Scene = {}): Data {
  const sessions = scene.sessions ?? ["ses_1"]
  return {
    session: {
      list: () => sessions.map((id) => ({ id })),
      status: (id: string) => scene.status?.[id] ?? "idle",
      pending: { list: (id: string) => scene.pending?.[id] ?? [] },
    },
  } as unknown as Data
}

describe("caffeinate busy state", () => {
  test("idle sessions do not hold Keep Awake", () => {
    expect(busy(data())).toBe(false)
    expect(busy(data({ sessions: ["ses_1", "ses_2"] }))).toBe(false)
  })

  test("a running session, including a subagent, holds Keep Awake", () => {
    expect(busy(data({ status: { ses_1: "running" } }))).toBe(true)
    expect(busy(data({ sessions: ["ses_1", "ses_2"], status: { ses_2: "running" } }))).toBe(true)
  })

  test("a queued prompt holds Keep Awake", () => {
    expect(busy(data({ pending: { ses_1: [{ type: "user" }] } }))).toBe(true)
    expect(busy(data({ pending: { ses_1: [{ type: "synthetic" }] } }))).toBe(false)
  })

  test("a hydration snapshot updates Keep Awake without a session event", () => {
    const scene = createRoot((dispose) => {
      const [sessions, setSessions] = createSignal<string[]>([])
      const [running, setRunning] = createSignal<Record<string, "idle" | "running">>({})
      const data = {
        session: {
          list: () => sessions().map((id) => ({ id })),
          status: (id: string) => running()[id] ?? "idle",
          pending: { list: () => [] },
        },
      } as unknown as Data
      const seen: boolean[] = []
      trackBusy(data, (value) => seen.push(value))
      return { seen, setSessions, setRunning, dispose }
    })

    expect(scene.seen).toEqual([false])

    // The server.connected snapshot adds a running session that sent no per-session event.
    scene.setSessions(["ses_1"])
    scene.setRunning({ ses_1: "running" })
    expect(scene.seen.at(-1)).toBe(true)

    // A reconnect snapshot can clear the last running session the same way.
    scene.setRunning({})
    expect(scene.seen.at(-1)).toBe(false)
    scene.dispose()
  })
})
