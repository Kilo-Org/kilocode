import { describe, expect, it } from "bun:test"
import { registerActivity } from "../../webview-ui/agent-manager/terminal/activity"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"
import type { Activity } from "../../webview-ui/src/utils/session-activity"

function receiver() {
  const states: Activity[] = []
  let handle!: (data: string) => boolean | Promise<boolean>
  let disposed = false
  const receiver = registerActivity(
    {
      registerOscHandler: (id, callback) => {
        expect(id).toBe(777)
        handle = callback
        return {
          dispose: () => {
            disposed = true
          },
        }
      },
    },
    (state) => states.push(state),
  )
  return { ...receiver, states, handle: (data: string) => handle(data), disposed: () => disposed }
}

const packet = (state: string, time = Date.now()) => `kilo;activity;1;${state};${time}`

describe("terminal activity", () => {
  it("accepts every state and clears on disconnect and disposal", () => {
    const input = receiver()
    for (const state of ["idle", "busy", "retry", "waiting", "error", "done"] as const) {
      expect(input.handle(packet(state))).toBe(true)
      expect(input.states.at(-1)).toBe(state)
    }
    input.clear()
    expect(input.states.at(-1)).toBe("idle")
    input.handle(packet("busy"))
    input.dispose()
    expect(input.states.at(-1)).toBe("idle")
    expect(input.disposed()).toBe(true)
  })

  it("ignores malformed, stale, future and unrelated output", () => {
    const input = receiver()
    expect(input.handle("notify;hello")).toBe(false)
    for (const value of [
      packet("unknown"),
      packet("busy", Date.now() - 16_000),
      packet("busy", Date.now() + 6_000),
      "kilo;activity;2;busy;1",
      "kilo;activity;1;busy;NaN",
      `${packet("busy")};extra`,
    ]) {
      expect(input.handle(value)).toBe(true)
    }
    expect(input.states).toEqual([])
    input.dispose()
  })

  it("expires a signal that is not refreshed", async () => {
    const input = receiver()
    input.handle(packet("busy", Date.now() - 14_950))
    expect(input.states).toEqual(["busy"])
    await Bun.sleep(80)
    expect(input.states).toEqual(["busy", "idle"])
    input.dispose()
  })

  it("aggregates tab and side activity without remounting or crossing projects", () => {
    const state = createTerminalState(() => "one:wt")
    const add = (id: string, context: string, placement: "tab" | "side") =>
      state.add(context, {
        id,
        title: id,
        placement,
        wsUrl: "",
        font: { fontFamily: "monospace", fontSize: 12 },
      })
    add("first", "one:wt", "tab")
    add("second", "one:wt", "side")
    add("other", "two:wt", "tab")
    const record = state.all().at(0)
    state.setActivity("first", "busy")
    state.setActivity("second", "waiting")
    state.setActivity("other", "error")
    expect(state.activityFor("one:wt")).toBe("waiting")
    expect(state.activityFor("two:wt")).toBe("error")
    state.setActivity("second", "idle")
    expect(state.activityFor("one:wt")).toBe("busy")
    expect(state.all().at(0)).toBe(record)
    state.remove("first")
    expect(state.activityFor("one:wt")).toBe("idle")
    expect(state.activity("first")).toBe("idle")
    state.setActivity("first", "busy")
    expect(state.activity("first")).toBe("idle")
  })
})
