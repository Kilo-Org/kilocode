import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { touch, useToolMotion } from "./tool-motion"

globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) =>
  setTimeout(() => fn(performance.now()), 0) as unknown as number

let next = 0
const id = () => `part-${++next}`

function mount(key: string, status = "running") {
  const [state, setState] = createSignal(status)
  return createRoot((dispose) => {
    const motion = useToolMotion({ id: key, status: state })
    return { motion, setState, dispose }
  })
}

describe("useToolMotion", () => {
  test("enters a row that mounts right after a streamed update", () => {
    const key = id()
    touch(key)
    const row = mount(key)
    expect(row.motion.entering()).toBe(true)
    expect(row.motion.live()).toBe(true)
    row.dispose()
  })

  test("does not replay the entry when the same row mounts again", () => {
    const key = id()
    touch(key)
    mount(key).dispose()
    touch(key)
    const again = mount(key)
    expect(again.motion.entering()).toBe(false)
    expect(again.motion.live()).toBe(false)
    again.dispose()
  })

  test("keeps rows from history still until their status changes", () => {
    const row = mount(id(), "completed")
    expect(row.motion.entering()).toBe(false)
    expect(row.motion.live()).toBe(false)
    row.setState("error")
    expect(row.motion.live()).toBe(true)
    row.dispose()
  })

  test("staggers rows that mount in the same frame and clears it after the entry", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    const rows = Array.from({ length: 8 }, () => {
      const key = id()
      touch(key)
      return mount(key)
    })
    expect(rows.map((row) => row.motion.stagger())).toEqual([0, 1, 2, 3, 4, 5, 5, 5])
    rows[1]!.motion.entered()
    expect(rows[1]!.motion.stagger()).toBe(0)
    expect(rows[1]!.motion.entering()).toBe(false)
    expect(rows[1]!.motion.live()).toBe(true)
    rows.forEach((row) => row.dispose())
  })
})
