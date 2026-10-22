import { expect, it } from "bun:test"
import { registerActivity } from "../../webview-ui/agent-manager/terminal/activity"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"
import type { Activity } from "../../webview-ui/src/utils/session-activity"

it("accepts all states, ignores invalid signals, and clears on expiry and disposal", async () => {
  const states: Activity[] = []
  let handle!: (data: string) => boolean | Promise<boolean>
  let disposed = false
  const input = registerActivity(
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
  const packet = (state: string, time = Date.now()) => `kilo;activity;1;${state};${time}`
  try {
    expect(handle("notify;hello")).toBe(false)
    for (const value of [
      packet("unknown"),
      packet("busy", Date.now() - 16_000),
      packet("busy", Date.now() + 6_000),
      "kilo;activity;2;busy;1",
      "kilo;activity;1;busy;NaN",
      `${packet("busy")};extra`,
    ]) {
      expect(handle(value)).toBe(true)
    }
    expect(states).toEqual([])
    for (const state of ["idle", "busy", "retry", "waiting", "error", "done"]) {
      expect(handle(packet(state))).toBe(true)
      expect(states.at(-1)).toBe(state)
    }
    input.clear()
    expect(states.at(-1)).toBe("idle")
    handle(packet("busy", Date.now() - 14_950))
    expect(states.at(-1)).toBe("busy")
    await Bun.sleep(80)
    expect(states.at(-1)).toBe("idle")
    handle(packet("busy"))
  } finally {
    input.dispose()
  }
  expect(states.at(-1)).toBe("idle")
  expect(disposed).toBe(true)
})

it("aggregates main and side terminals without remounting or crossing projects", () => {
  const state = createTerminalState(() => "one:wt")
  const add = (id: string, context: string, placement: "tab" | "side") =>
    state.add(context, { id, title: id, placement, wsUrl: "", font: { fontFamily: "monospace", fontSize: 12 } })
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
