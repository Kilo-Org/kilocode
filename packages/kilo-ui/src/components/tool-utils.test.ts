import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import { createThrottledValue, STREAMING_TEXT_RENDER_THROTTLE_MS, TEXT_RENDER_THROTTLE_MS } from "./tool-utils"

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Drive a source signal quickly and count how often the throttled value changes.
async function countRenders(interval: () => number, ticks: number, tickMs: number) {
  const [source, setSource] = createSignal("")
  let renders = -1
  let dispose = () => {}
  createRoot((d) => {
    dispose = d
    const value = createThrottledValue(source, interval)
    createEffect(() => {
      value()
      renders++
    })
  })
  for (let i = 1; i <= ticks; i++) {
    setSource("x".repeat(i))
    await tick(tickMs)
  }
  await tick(TEXT_RENDER_THROTTLE_MS + 50)
  dispose()
  return renders
}

describe("createThrottledValue cadence", () => {
  test("returns the initial value immediately", () => {
    createRoot((dispose) => {
      const value = createThrottledValue(() => "hello")
      expect(value()).toBe("hello")
      dispose()
    })
  })

  test("repaints more often at the streaming interval than the idle interval", async () => {
    const idle = await countRenders(() => TEXT_RENDER_THROTTLE_MS, 30, 6)
    const streaming = await countRenders(() => STREAMING_TEXT_RENDER_THROTTLE_MS, 30, 6)
    expect(streaming).toBeGreaterThan(idle * 2)
  })

  test("falls back to the idle cadence once streaming ends", async () => {
    const [live, setLive] = createSignal(true)
    const interval = () => (live() ? STREAMING_TEXT_RENDER_THROTTLE_MS : TEXT_RENDER_THROTTLE_MS)

    const fast = await countRenders(interval, 30, 6)
    setLive(false)
    await tick(TEXT_RENDER_THROTTLE_MS + 50)
    const slow = await countRenders(interval, 30, 6)
    expect(fast).toBeGreaterThan(slow)
  })

  test("flushes the pending tail immediately when the cadence slows", async () => {
    const [source, setSource] = createSignal("a")
    const [live, setLive] = createSignal(true)
    let current = ""
    let dispose = () => {}
    createRoot((d) => {
      dispose = d
      const value = createThrottledValue(source, () =>
        live() ? STREAMING_TEXT_RENDER_THROTTLE_MS : TEXT_RENDER_THROTTLE_MS,
      )
      createEffect(() => {
        current = value()
      })
    })
    await tick(20)

    setSource("b")
    await tick(0)
    setSource("c")
    await tick(0)
    setSource("d")
    await tick(0)
    expect(current).toBe("b")

    const start = Date.now()
    setLive(false)
    await tick(0)
    expect(current).toBe("d")
    expect(Date.now() - start).toBeLessThan(50)
    dispose()
  })
})
