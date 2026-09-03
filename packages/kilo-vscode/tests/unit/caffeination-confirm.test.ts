import { describe, expect, it } from "bun:test"
import { confirmCaffeination } from "../../src/services/caffeination/confirm"

function setup(ask: () => Promise<boolean>) {
  const state = { enabled: false, active: false, available: true }
  const toggle = confirmCaffeination(
    {
      getState: () => state,
      setEnabled: async (enabled) => {
        state.enabled = enabled
      },
    },
    ask,
  )
  return { state, toggle }
}

describe("keep-awake confirmation", () => {
  it("does not enable before explicit confirmation", async () => {
    const answer = Promise.withResolvers<boolean>()
    const { state, toggle } = setup(() => answer.promise)
    const pending = toggle(true)
    expect(state.enabled).toBe(false)
    answer.resolve(true)
    await pending
    expect(state.enabled).toBe(true)
  })

  it("leaves keep-awake off when confirmation is cancelled", async () => {
    const { state, toggle } = setup(async () => false)
    await toggle(true)
    expect(state.enabled).toBe(false)
  })

  it("shares a pending prompt and remembers consent only for this controller", async () => {
    const answer = Promise.withResolvers<boolean>()
    let calls = 0
    const { state, toggle } = setup(() => {
      calls++
      return answer.promise
    })
    const first = toggle(true)
    const second = toggle(true)
    expect(second).toBe(first)
    answer.resolve(true)
    await first
    await toggle(false)
    await toggle(true)
    expect(state.enabled).toBe(true)
    expect(calls).toBe(1)
  })

  it("does not re-enable after being disabled while confirmation is open", async () => {
    const answer = Promise.withResolvers<boolean>()
    const { state, toggle } = setup(() => answer.promise)
    const pending = toggle(true)
    await toggle(false)
    answer.resolve(true)
    await pending
    expect(state.enabled).toBe(false)
  })

  it("does not prompt for an unavailable feature", async () => {
    let calls = 0
    const { state, toggle } = setup(async () => {
      calls++
      return true
    })
    state.available = false
    await toggle(true)
    expect(calls).toBe(0)
    expect(state.enabled).toBe(false)
  })
})
