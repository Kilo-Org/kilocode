import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSmoothText } from "../src/components/tool-utils"

function setup(initial: string) {
  const [text, setText] = createSignal(initial)
  const [live, setLive] = createSignal(true)
  const view = createRoot((dispose) => ({ shown: createSmoothText(text, live), dispose }))
  return { ...view, setText, setLive }
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

async function until(check: () => boolean, timeout = 1000) {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error("timed out")
    await frame()
  }
}

test("a streamed burst is revealed over several frames", async () => {
  const view = setup("Start")
  expect(view.shown()).toBe("Start")
  const burst = `Start${" word".repeat(400)}`
  view.setText(burst)
  expect(view.shown()).toBe("Start")
  await frame()
  await frame()
  expect(view.shown().length).toBeGreaterThan("Start".length)
  expect(view.shown().length).toBeLessThan(burst.length)
  expect(burst.startsWith(view.shown())).toBe(true)
  await until(() => view.shown() === burst)
  view.dispose()
})

test("the end of a stream drains the rest instead of jumping", async () => {
  const view = setup("")
  const burst = "x".repeat(2000)
  view.setText(burst)
  view.setLive(false)
  expect(view.shown().length).toBeLessThan(burst.length)
  await until(() => view.shown() === burst, 500)
  view.dispose()
})

test("text that does not extend what is shown replaces it at once", () => {
  const view = setup("First answer")
  view.setText("Other")
  expect(view.shown()).toBe("Other")
  view.dispose()
})

test("a surrogate pair is never split", async () => {
  const view = setup("")
  const burst = "😀".repeat(300)
  view.setText(burst)
  const seen: string[] = []
  await until(() => {
    seen.push(view.shown())
    return view.shown() === burst
  })
  expect(seen.every((value) => !/[\ud800-\udbff]$/.test(value))).toBe(true)
  view.dispose()
})
