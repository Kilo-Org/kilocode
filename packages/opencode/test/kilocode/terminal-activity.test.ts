import { describe, expect, test } from "bun:test"
import type { Event } from "@kilocode/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { KiloTerminalActivity } from "../../src/kilocode/cli/cmd/tui/terminal-activity"

function data(input: Partial<KiloTerminalActivity.Data> = {}): KiloTerminalActivity.Data {
  return {
    session: [
      { id: "parent", title: "Session" },
      { id: "child", title: "Child", parentID: "parent" },
    ],
    session_status: {},
    permission: {},
    question: {},
    suggestion: {},
    network: {},
    message: {},
    part: {},
    ...input,
  }
}

function events() {
  const listeners = new Set<(event: Event) => void>()
  return {
    listeners,
    subscribe: (handler: (event: Event) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    emit(event: Event) {
      for (const handler of listeners) handler(event)
    },
  }
}

function state(value: string) {
  return value.split(";").at(4)
}

describe("terminal activity", () => {
  test("home is idle even when sessions are active", () => {
    expect(KiloTerminalActivity.classify({ data: data({ session_status: { parent: { type: "busy" } } }) })).toBe("idle")
  })

  test("uses real status before session metadata arrives", () => {
    for (const type of ["idle", "busy", "retry"] as const) {
      expect(
        KiloTerminalActivity.classify({
          id: "parent",
          data: data({ session: [], session_status: { parent: { type } } }),
        }),
      ).toBe(type)
    }
  })

  test("child attention overrides running and completed outcomes", () => {
    for (const key of ["permission", "question", "suggestion", "network"] as const) {
      expect(
        KiloTerminalActivity.classify({
          id: "parent",
          data: data({ [key]: { child: [{}] }, session_status: { parent: { type: "busy" } } }),
          outcomes: { parent: "completed" },
        }),
      ).toBe("waiting")
    }
    expect(
      KiloTerminalActivity.classify({ id: "parent", data: data({ session_status: { child: { type: "offline" } } }) }),
    ).toBe("waiting")
    expect(
      KiloTerminalActivity.classify({
        id: "parent",
        data: data({
          message: { child: [{ id: "plan", role: "assistant" }] },
          part: { plan: [{ type: "tool", tool: "plan_exit", state: { status: "completed" } }] },
        }),
      }),
    ).toBe("waiting")
  })

  test("includes child activity when viewing parent or child", () => {
    for (const id of ["parent", "child"]) {
      for (const type of ["busy", "retry"] as const) {
        expect(
          KiloTerminalActivity.classify({
            id,
            data: data({ session_status: { child: { type } } }),
            outcomes: { parent: "completed" },
          }),
        ).toBe(type)
      }
    }
  })

  test("only completed outcomes are done", () => {
    for (const [outcome, expected] of [
      [undefined, "idle"],
      ["completed", "done"],
      ["error", "error"],
      ["interrupted", "idle"],
      ["superseded", "idle"],
    ] as const) {
      expect(KiloTerminalActivity.classify({ id: "parent", data: data(), outcomes: { parent: outcome } })).toBe(
        expected,
      )
    }
  })

  test("failed or incomplete assistant messages are never success", () => {
    for (const [finish, expected] of [
      ["error", "error"],
      ["content-filter", "error"],
      ["length", "idle"],
      ["unknown", "idle"],
      ["other", "idle"],
      ["tool-calls", "idle"],
    ] as const) {
      expect(
        KiloTerminalActivity.classify({
          id: "parent",
          data: data({ message: { parent: [{ id: "reply", role: "assistant", finish }] } }),
          outcomes: { parent: "completed" },
        }),
      ).toBe(expected)
    }
    for (const [name, expected] of [
      ["APIError", "error"],
      ["MessageAbortedError", "idle"],
    ] as const) {
      expect(
        KiloTerminalActivity.classify({
          id: "parent",
          data: data({ message: { parent: [{ id: "reply", role: "assistant", finish: "stop", error: { name } }] } }),
          outcomes: { parent: "completed" },
        }),
      ).toBe(expected)
    }
  })

  test("formats all six states as OSC 777 with BEL and a millisecond timestamp", () => {
    const timestamp = Date.now()
    for (const value of ["idle", "busy", "retry", "waiting", "error", "done"] as const) {
      expect(KiloTerminalActivity.format(value, timestamp)).toBe(`\x1b]777;kilo;activity;1;${value};${timestamp}\x07`)
    }
    const before = Date.now()
    const signal = KiloTerminalActivity.format("busy")
    expect(signal).toMatch(/^\x1b\]777;kilo;activity;1;busy;\d+\x07$/)
    expect(Number(signal.split(";").at(-1)?.slice(0, -1))).toBeGreaterThanOrEqual(before)
    expect(Number(signal.split(";").at(-1)?.slice(0, -1))).toBeLessThanOrEqual(Date.now())
  })

  test("does not subscribe or write without the exact opt-in", () => {
    for (const enabled of [undefined, "", "0", "true"]) {
      const source = events()
      const output: string[] = []
      const dispose = createRoot((dispose) => {
        KiloTerminalActivity.use({
          enabled,
          session: () => "parent",
          data: data(),
          subscribe: source.subscribe,
          write: (value) => output.push(value),
        })
        return dispose
      })
      dispose()
      expect(source.listeners.size).toBe(0)
      expect(output).toEqual([])
    }
  })

  test("sends initial state, reactive transitions, and idle cleanup independently of titles", () => {
    const source = events()
    const output: string[] = []
    const [session, select] = createSignal<string | undefined>("parent")
    const [store, set] = createStore(data({ session_status: { parent: { type: "busy" } } }))
    const dispose = createRoot((dispose) => {
      KiloTerminalActivity.use({
        enabled: "1",
        session,
        data: store,
        subscribe: source.subscribe,
        write: (value) => output.push(value),
      })
      return dispose
    })
    try {
      expect(output.map(state)).toEqual(["busy"])
      set("session", 0, "title", "Renamed")
      expect(output).toHaveLength(1)
      set("question", "child", [{}])
      set("question", "child", [])
      set("session_status", "parent", { type: "retry" })
      set("session_status", "parent", { type: "idle" })
      source.emit({ id: "failed", type: "session.error", properties: { sessionID: "parent" } })
      source.emit({
        id: "closed",
        type: "session.turn.close",
        properties: { sessionID: "parent", reason: "completed" },
      })
      expect(output.at(-1)).toContain(";error;")
      source.emit({ id: "opened", type: "session.turn.open", properties: { sessionID: "parent" } })
      source.emit({
        id: "completed",
        type: "session.turn.close",
        properties: { sessionID: "parent", reason: "completed" },
      })
      select(undefined)
      expect(output.map(state)).toEqual(["busy", "waiting", "busy", "retry", "idle", "error", "idle", "done", "idle"])
    } finally {
      dispose()
    }
    expect(source.listeners.size).toBe(0)
    expect(state(output.at(-1)!)).toBe("idle")
    const count = output.length
    select("parent")
    set("session_status", "parent", { type: "busy" })
    expect(output).toHaveLength(count)
  })

  test("refreshes the current state every five seconds and stops on cleanup", async () => {
    const source = events()
    const output: string[] = []
    const heartbeat = Promise.withResolvers<void>()
    const dispose = createRoot((dispose) => {
      KiloTerminalActivity.use({
        enabled: "1",
        session: () => "parent",
        data: data({ session_status: { parent: { type: "retry" } } }),
        subscribe: source.subscribe,
        write: (value) => {
          output.push(value)
          if (output.length === 2) heartbeat.resolve()
        },
      })
      return dispose
    })
    try {
      await heartbeat.promise
      expect(output.map(state)).toEqual(["retry", "retry"])
      const stamps = output.map((value) => Number(value.split(";").at(-1)?.slice(0, -1)))
      expect(stamps.at(1)! - stamps.at(0)!).toBeGreaterThanOrEqual(4_900)
    } finally {
      dispose()
    }
    expect(output.map(state)).toEqual(["retry", "retry", "idle"])
    await Bun.sleep(5_100)
    expect(output).toHaveLength(3)
  }, 15_000)
})
