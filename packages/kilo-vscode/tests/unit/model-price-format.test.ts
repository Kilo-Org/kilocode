import { describe, it, expect } from "bun:test"
import { fmtPrice } from "../../webview-ui/src/components/shared/model-preview-utils"

// Prices arriving at fmtPrice are already in $/M tokens (converted by parseApiPrice).
// This test suite guards against the double-multiplication bug where fmtPrice was
// incorrectly multiplying by 1_000_000 again, turning $3.00/1M into $3,000,000.00/1M.

describe("fmtPrice", () => {
  it("formats Claude Sonnet 4.6 input price correctly ($3/1M)", () => {
    expect(fmtPrice(3)).toBe("$3.00/1M")
  })

  it("formats Claude Sonnet 4.6 output price correctly ($15/1M)", () => {
    expect(fmtPrice(15)).toBe("$15.00/1M")
  })

  it("returns 'Free' for zero price", () => {
    expect(fmtPrice(0)).toBe("Free")
  })

  it("uses 4 decimal places for sub-cent prices", () => {
    expect(fmtPrice(0.005)).toBe("$0.0050/1M")
  })

  it("uses 2 decimal places at the $0.01 boundary", () => {
    expect(fmtPrice(0.01)).toBe("$0.01/1M")
  })

  it("formats a typical cheap model price ($0.50/1M)", () => {
    expect(fmtPrice(0.5)).toBe("$0.50/1M")
  })

  it("formats a high-cost model price ($75/1M)", () => {
    expect(fmtPrice(75)).toBe("$75.00/1M")
  })
})
