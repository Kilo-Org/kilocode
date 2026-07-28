// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { connected } from "../src/component/use-connected"

const provider = (id: string, input?: number): Parameters<typeof connected>[0][number] => ({
  id,
  models: input === undefined ? {} : { model: { cost: { input } } },
})

describe("connected", () => {
  test("does not treat anonymous built-in providers as connected", () => {
    expect(connected([provider("kilo", 0)])).toBe(false)
    expect(connected([provider("opencode", 0)])).toBe(false)
  })

  test("accepts authenticated built-ins and ordinary providers", () => {
    expect(connected([provider("kilo", 1)])).toBe(true)
    expect(connected([provider("opencode", 1)])).toBe(true)
    expect(connected([provider("anthropic")])).toBe(true)
  })
})
