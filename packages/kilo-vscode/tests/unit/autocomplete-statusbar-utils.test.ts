import { describe, it, expect } from "bun:test"
import { humanFormatSessionCost, formatTime } from "../../src/services/autocomplete/statusbar-utils"

describe("humanFormatSessionCost", () => {
  it("returns '$0.00' for 0 cost", () => {
    expect(humanFormatSessionCost(0)).toBe("$0.00")
  })

  it("returns '<$0.01' for very small cost", () => {
    expect(humanFormatSessionCost(0.001)).toBe("<$0.01")
  })

  it("formats exactly $0.01 as dollar string (not less-than-cent)", () => {
    const result = humanFormatSessionCost(0.01)
    expect(result).toBe("$0.01")
  })

  it("formats $0.12 correctly", () => {
    expect(humanFormatSessionCost(0.12)).toBe("$0.12")
  })

  it("formats $1.00 correctly", () => {
    expect(humanFormatSessionCost(1.0)).toBe("$1.00")
  })

  it("formats $1.005 rounded to 2 decimal places", () => {
    const result = humanFormatSessionCost(1.005)
    expect(result.startsWith("$")).toBe(true)
    expect(result).toMatch(/^\$\d+\.\d{2}$/)
  })

  it("formats $0.009 as '<$0.01'", () => {
    expect(humanFormatSessionCost(0.009)).toBe("<$0.01")
  })
})

describe("formatTime", () => {
  it("contains at least two colon-separated time components", () => {
    const result = formatTime(Date.now())
    expect(result).toMatch(/\d+:\d+/)
  })

  it("formats a known timestamp with correct hour and minute", () => {
    const ts = new Date("2024-01-15T14:30:45").getTime()
    const result = formatTime(ts)
    expect(result).toMatch(/30/)
    expect(result).toMatch(/45/)
  })

  it("produces different output for different timestamps", () => {
    const ts1 = new Date("2024-01-01T10:00:00").getTime()
    const ts2 = new Date("2024-01-01T15:30:00").getTime()
    expect(formatTime(ts1)).not.toBe(formatTime(ts2))
  })
})
