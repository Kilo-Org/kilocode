import { afterEach, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { CountUp, COUNT_UP_MS } from "../src/components/count-up"
import { mount, waitFor, type Mounted } from "./harness"

const mounted: Mounted[] = []

afterEach(() => {
  for (const value of mounted) value.dispose()
  mounted.length = 0
})

const shown = (value: Mounted) => Number(value.host.querySelector('[data-component="count-up"]')?.textContent)

test("shows the first value at once", () => {
  const value = mount(() => <CountUp value={42} />)
  mounted.push(value)

  expect(shown(value)).toBe(42)
})

test("counts through the values between a change and settles on the new value", async () => {
  const [count, setCount] = createSignal(10)
  const value = mount(() => <CountUp value={count()} />)
  mounted.push(value)
  const seen = new Set<number>()

  setCount(110)
  expect(shown(value)).toBe(10)
  await waitFor(() => {
    seen.add(shown(value))
    return shown(value) === 110
  }, COUNT_UP_MS * 4)

  expect([...seen].some((item) => item > 10 && item < 110)).toBe(true)
})

test("counts up from `from` on mount", async () => {
  const value = mount(() => <CountUp value={7} from={0} />)
  mounted.push(value)

  expect(shown(value)).toBe(0)
  await waitFor(() => shown(value) === 7, COUNT_UP_MS * 4)
})
