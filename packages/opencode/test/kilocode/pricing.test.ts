import { test, expect, describe } from "bun:test"
import { formatPricing } from "../../src/kilocode/pricing"

describe("formatPricing", () => {
  test("returns undefined for undefined cost", () => {
    expect(formatPricing(undefined)).toBeUndefined()
  })

  test("returns undefined when both input and output are zero", () => {
    expect(formatPricing({ input: 0, output: 0 })).toBeUndefined()
  })

  test("formats typical model pricing", () => {
    expect(formatPricing({ input: 3, output: 15 })).toBe("$3/$15")
  })

  test("formats sub-dollar pricing", () => {
    expect(formatPricing({ input: 0.25, output: 1.25 })).toBe("$0.25/$1.25")
  })

  test("formats very cheap models", () => {
    expect(formatPricing({ input: 0.075, output: 0.3 })).toBe("$0.075/$0.3")
  })

  test("formats free input with paid output", () => {
    expect(formatPricing({ input: 0, output: 15 })).toBe("$0/$15")
  })

  test("formats large prices", () => {
    expect(formatPricing({ input: 100, output: 200 })).toBe("$100/$200")
  })

  test("formats mid-range prices without trailing zeros", () => {
    expect(formatPricing({ input: 2.5, output: 10 })).toBe("$2.5/$10")
  })
})
