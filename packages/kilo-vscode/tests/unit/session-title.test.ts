import { describe, expect, it } from "bun:test"
import { parseSessionTitle, SESSION_TITLE_LIMIT } from "../../src/shared/session-title"

describe("parseSessionTitle", () => {
  it("rejects non-string input from untrusted callers", () => {
    expect(parseSessionTitle(null)).toEqual({ error: "invalid" })
  })

  it("trims a valid title", () => {
    expect(parseSessionTitle("  Review authentication flow  ")).toEqual({ value: "Review authentication flow" })
  })

  it("rejects empty titles", () => {
    expect(parseSessionTitle("  \t \n ")).toEqual({ error: "required" })
  })

  it("accepts the display limit and rejects longer titles", () => {
    expect(parseSessionTitle("a".repeat(SESSION_TITLE_LIMIT))).toEqual({ value: "a".repeat(SESSION_TITLE_LIMIT) })
    expect(parseSessionTitle("a".repeat(SESSION_TITLE_LIMIT + 1))).toEqual({ error: "too_long" })
  })

  it("rejects every blocked control and directional formatting range", () => {
    const values = [
      "Task\u0000suffix",
      "Task\u001bsuffix",
      "Task\u001fsuffix",
      "Task\u007fsuffix",
      "Task\u009fsuffix",
      "Task\u061csuffix",
      "Task\u200esuffix",
      "Task\u200fsuffix",
      "Task\u2028suffix",
      "Task\u2029suffix",
      "Task\u202asuffix",
      "Task\u202esuffix",
      "Task\u2066suffix",
      "Task\u2069suffix",
    ]
    for (const value of values) expect(parseSessionTitle(value)).toEqual({ error: "control" })
  })

  it("accepts normal unicode display text", () => {
    expect(parseSessionTitle("Analyse de la session - \u4fee\u6b63")).toEqual({
      value: "Analyse de la session - \u4fee\u6b63",
    })
  })
})
