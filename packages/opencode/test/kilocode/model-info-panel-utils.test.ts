import { describe, expect, test } from "bun:test"
import { avgPrice, fmtCachedPrice, fmtContext, fmtPrice } from "../../src/kilocode/components/model-info-panel-utils"

describe("model info panel price formatting", () => {
  test("fmtPrice returns Free for zero", () => {
    expect(fmtPrice(0)).toBe("Free")
  })

  test("fmtPrice uses four decimals for very small prices", () => {
    expect(fmtPrice(0.0095)).toBe("$0.0095/1M")
  })

  test("fmtPrice uses two decimals for standard prices", () => {
    expect(fmtPrice(3)).toBe("$3.00/1M")
  })

  test("fmtCachedPrice returns cache read price when available", () => {
    expect(fmtCachedPrice({ input: 3, output: 15, cache: { read: 0.3, write: 0 } })).toBe("$0.30/1M")
  })

  test("fmtCachedPrice returns Free for free models", () => {
    expect(fmtCachedPrice({ input: 0, output: 0, cache: { read: 0, write: 0 } })).toBe("Free")
  })

  test("fmtCachedPrice returns N/A without cache read", () => {
    expect(fmtCachedPrice({ input: 3, output: 15, cache: { read: 0, write: 0 } })).toBe("N/A")
  })

  test("avgPrice uses cache weighted formula when cache read exists", () => {
    const val = avgPrice({ input: 3, output: 15, cache: { read: 0.3, write: 0 } })
    expect(val).toBe(2.31)
  })

  test("avgPrice uses input and output weighted formula without cache read", () => {
    const val = avgPrice({ input: 3, output: 15, cache: { read: 0, write: 0 } })
    expect(val).toBe(4.2)
  })
})

describe("model info panel context formatting", () => {
  test("formats thousands as K", () => {
    expect(fmtContext(128000)).toBe("128K")
  })

  test("formats millions as M", () => {
    expect(fmtContext(1000000)).toBe("1M")
  })

  test("returns exact value for small contexts", () => {
    expect(fmtContext(800)).toBe("800")
  })
})
