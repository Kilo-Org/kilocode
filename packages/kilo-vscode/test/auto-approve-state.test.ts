import { describe, expect, it } from "bun:test"
import { createAutoApproveState } from "../src/auto-approve-state"

function harness(stored = false) {
  const state = { stored, updates: [] as boolean[] }
  const calls = { broadcast: [] as boolean[], notify: 0, shown: [] as string[] }
  const controller = createAutoApproveState({
    read: () => state.stored,
    update: (value) => {
      state.updates.push(value)
      state.stored = value
      return Promise.resolve()
    },
    broadcast: (value) => calls.broadcast.push(value),
    notify: () => (calls.notify += 1),
    message: (value) => (value ? "enabled" : "disabled"),
    show: (message) => calls.shown.push(message),
  })
  return { controller, state, calls }
}

describe("auto-approve state", () => {
  it("toggles the stored value and reports it once", async () => {
    const { controller, state, calls } = harness(false)

    await controller.toggle()
    expect(state.updates).toEqual([true])
    expect(calls.broadcast).toEqual([true])
    expect(calls.notify).toBe(1)
    expect(calls.shown).toEqual(["enabled"])

    await controller.toggle()
    expect(state.stored).toBe(false)
    expect(calls.broadcast).toEqual([true, false])
    expect(calls.shown).toEqual(["enabled", "disabled"])
  })

  it("writes an explicit value instead of toggling", async () => {
    const { controller, state, calls } = harness(true)

    await controller.set(true)
    expect(state.updates).toEqual([true])
    expect(calls.broadcast).toEqual([true])
  })

  it("stays silent when the store does not keep the value", async () => {
    const calls = { broadcast: [] as boolean[], notify: 0, shown: [] as string[] }
    const controller = createAutoApproveState({
      read: () => false,
      update: () => Promise.resolve(),
      broadcast: (value) => calls.broadcast.push(value),
      notify: () => (calls.notify += 1),
      message: (value) => (value ? "enabled" : "disabled"),
      show: (message) => calls.shown.push(message),
    })

    await controller.set(true)
    expect(calls).toEqual({ broadcast: [], notify: 0, shown: [] })
  })

  it("writes before broadcasting, waking the sweep or confirming", async () => {
    const order: string[] = []
    let stored = false
    const controller = createAutoApproveState({
      read: () => stored,
      update: async () => {
        order.push("write")
        stored = true
      },
      broadcast: () => order.push("broadcast"),
      notify: () => order.push("notify"),
      message: () => "enabled",
      show: () => order.push("show"),
    })

    await controller.toggle()
    expect(order).toEqual(["write", "broadcast", "notify", "show"])
  })

  it("reads the stored value", () => {
    expect(harness(true).controller.value()).toBe(true)
    expect(harness(false).controller.value()).toBe(false)
  })
})
