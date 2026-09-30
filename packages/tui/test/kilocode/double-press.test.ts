import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createDoublePress } from "../../src/kilocode/double-press"

function setup(window: number) {
  return createRoot((dispose) => ({ press: createDoublePress(window), dispose }))
}

describe("createDoublePress", () => {
  test("confirms on the second press and resets", () => {
    const item = setup(1_000)
    expect(item.press.press()).toBe(false)
    expect(item.press.count()).toBe(1)
    expect(item.press.press()).toBe(true)
    expect(item.press.count()).toBe(0)
    expect(item.press.press()).toBe(false)
    item.dispose()
  })

  test("expires the first press after the window", async () => {
    const item = setup(20)
    expect(item.press.press()).toBe(false)
    await Bun.sleep(40)
    expect(item.press.count()).toBe(0)
    expect(item.press.press()).toBe(false)
    item.dispose()
  })

  test("a timer from an earlier gesture does not cut a later window short", async () => {
    const item = setup(60)
    item.press.press()
    expect(item.press.press()).toBe(true)
    await Bun.sleep(30)
    item.press.press()
    // the first gesture's timer would have fired here if it had not been cleared
    await Bun.sleep(40)
    expect(item.press.count()).toBe(1)
    item.dispose()
  })
})
