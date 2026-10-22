import { describe, expect, test } from "bun:test"
import {
  DEFAULT_CONTEXT_SIDEBAR_WIDTH,
  MAX_CONTEXT_SIDEBAR_WIDTH,
  MIN_CONTEXT_SIDEBAR_WIDTH,
  normalizeConsoleDiffStyle,
  normalizeContextSidebarWidth,
  parseContextSidebarWidth,
} from "./console"

describe("console UI config state", () => {
  test("defaults the diff layout to unified", () => {
    expect(normalizeConsoleDiffStyle(undefined)).toBe("unified")
    expect(normalizeConsoleDiffStyle("unified")).toBe("unified")
    expect(normalizeConsoleDiffStyle("split")).toBe("split")
    expect(normalizeConsoleDiffStyle("side-by-side")).toBe("unified")
  })

  test("normalizes missing and out-of-range widths", () => {
    expect(normalizeContextSidebarWidth(undefined)).toBe(DEFAULT_CONTEXT_SIDEBAR_WIDTH)
    expect(normalizeContextSidebarWidth(Number.NaN)).toBe(DEFAULT_CONTEXT_SIDEBAR_WIDTH)
    expect(normalizeContextSidebarWidth(100)).toBe(MIN_CONTEXT_SIDEBAR_WIDTH)
    expect(normalizeContextSidebarWidth(900)).toBe(MAX_CONTEXT_SIDEBAR_WIDTH)
    expect(normalizeContextSidebarWidth(411.6)).toBe(412)
  })

  test("accepts only integer widths within the supported range", () => {
    expect(parseContextSidebarWidth("352")).toBe(352)
    expect(parseContextSidebarWidth(String(MIN_CONTEXT_SIDEBAR_WIDTH))).toBe(MIN_CONTEXT_SIDEBAR_WIDTH)
    expect(parseContextSidebarWidth(String(MAX_CONTEXT_SIDEBAR_WIDTH))).toBe(MAX_CONTEXT_SIDEBAR_WIDTH)
    expect(parseContextSidebarWidth("249")).toBeUndefined()
    expect(parseContextSidebarWidth("801")).toBeUndefined()
    expect(parseContextSidebarWidth("352.5")).toBeUndefined()
    expect(parseContextSidebarWidth("wide")).toBeUndefined()
  })
})
