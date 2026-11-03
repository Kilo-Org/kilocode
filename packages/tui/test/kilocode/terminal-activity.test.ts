import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { activity, createEmitter, format, HEARTBEAT } from "../../src/kilocode/terminal-activity"

type Data = Plugin.Context["data"]

interface Scene {
  roots?: Record<string, string>
  family?: Record<string, string[]>
  status?: Record<string, "idle" | "running">
  outcome?: Record<string, "succeeded" | "failed" | "interrupted" | undefined>
  permissions?: Record<string, number>
  forms?: Record<string, number>
  retry?: string[]
  pending?: Record<string, Array<{ type: string }>>
}

function data(scene: Scene = {}): Data {
  return {
    session: {
      root: (id: string) => scene.roots?.[id] ?? id,
      family: (id: string) => scene.family?.[id] ?? [],
      status: (id: string) => scene.status?.[id] ?? "idle",
      get: (id: string) => (id in (scene.outcome ?? {}) ? { outcome: scene.outcome?.[id] } : undefined),
      permission: { list: (id: string) => Array.from({ length: scene.permissions?.[id] ?? 0 }, () => ({})) },
      form: { list: (id: string) => Array.from({ length: scene.forms?.[id] ?? 0 }, () => ({})) },
      message: {
        list: (id: string) =>
          scene.retry?.includes(id) ? [{ type: "assistant", retry: { attempt: 1 } }] : [],
      },
      pending: { list: (id: string) => scene.pending?.[id] ?? [] },
    },
  } as unknown as Data
}

describe("terminal activity", () => {
  test("an unknown session is idle", () => {
    expect(activity(data(), "ses_1")).toBe("idle")
  })

  test("a pending permission or form waits for input, including in a subagent", () => {
    expect(activity(data({ permissions: { ses_1: 1 } }), "ses_1")).toBe("waiting")
    expect(activity(data({ family: { ses_1: ["ses_1", "ses_2"] }, forms: { ses_2: 1 } }), "ses_1")).toBe("waiting")
  })

  test("a running session is busy, or retry when a step retries", () => {
    expect(activity(data({ status: { ses_1: "running" } }), "ses_1")).toBe("busy")
    expect(activity(data({ status: { ses_1: "running" }, retry: ["ses_1"] }), "ses_1")).toBe("retry")
    expect(activity(data({ status: { ses_2: "running" }, family: { ses_1: ["ses_1", "ses_2"] } }), "ses_1")).toBe(
      "busy",
    )
  })

  test("a queued prompt is busy", () => {
    expect(activity(data({ pending: { ses_1: [{ type: "user" }] } }), "ses_1")).toBe("busy")
    expect(activity(data({ pending: { ses_1: [{ type: "synthetic" }] } }), "ses_1")).toBe("idle")
  })

  test("the last outcome reports done or an error", () => {
    expect(activity(data({ outcome: { ses_1: "succeeded" } }), "ses_1")).toBe("done")
    expect(activity(data({ outcome: { ses_1: "failed" } }), "ses_1")).toBe("error")
    expect(activity(data({ outcome: { ses_1: "interrupted" } }), "ses_1")).toBe("idle")
  })

  test("encodes one versioned OSC 777 packet", () => {
    expect(format("busy", 1700000000000)).toBe("\x1b]777;kilo;activity;1;busy;1700000000000\x07")
  })

  test("emits on change and repeats as a heartbeat", () => {
    const packets: string[] = []
    let time = 1_000
    const scene: Scene = { status: { ses_1: "running" } }
    const emitter = createEmitter({
      data: data(scene),
      session: () => "ses_1",
      write: (packet) => packets.push(packet),
      now: () => time,
    })
    emitter.tick()
    expect(packets).toEqual([format("busy", 1_000)])

    time += 500
    emitter.tick()
    expect(packets).toHaveLength(1)

    time += HEARTBEAT
    emitter.tick()
    expect(packets).toEqual([format("busy", 1_000), format("busy", 1_500 + HEARTBEAT)])

    scene.status = {}
    scene.outcome = { ses_1: "succeeded" }
    emitter.tick()
    expect(packets.at(-1)).toBe(format("done", 6_500))

    // A finished turn is not repeated, so the reader can clear the indicator.
    time += HEARTBEAT
    emitter.tick()
    expect(packets.at(-1)).toBe(format("done", 6_500))

    scene.outcome = {}
    scene.status = { ses_1: "running" }
    time += 500
    emitter.tick()
    expect(packets.at(-1)).toBe(format("busy", 12_000))

    emitter.stop()
    expect(packets.at(-1)).toBe(format("idle", 12_000))
  })

  test("emits idle when no session is open", () => {
    const packets: string[] = []
    const emitter = createEmitter({
      data: data({ status: { ses_1: "running" } }),
      session: () => undefined,
      write: (packet) => packets.push(packet),
      now: () => 1_000,
    })
    emitter.tick()
    expect(packets).toEqual([format("idle", 1_000)])
  })
})