import { describe, expect, test } from "bun:test"
import { parseCostAlert } from "@/kilocode/cli/cmd/tui/cost-alert"

describe("parseCostAlert", () => {
  test("prompts when no value is provided", () => {
    expect(parseCostAlert("")).toEqual({ type: "prompt" })
    expect(parseCostAlert("   ")).toEqual({ type: "prompt" })
  })

  test("parses positive limits", () => {
    expect(parseCostAlert("5")).toEqual({ type: "set", value: 5 })
    expect(parseCostAlert("$4.25")).toEqual({ type: "set", value: 4.25 })
  })

  test("parses disabled values", () => {
    expect(parseCostAlert("0")).toEqual({ type: "off" })
    expect(parseCostAlert("off")).toEqual({ type: "off" })
    expect(parseCostAlert("disable")).toEqual({ type: "off" })
    expect(parseCostAlert("clear")).toEqual({ type: "off" })
  })

  test("treats disabled keywords case-insensitively", () => {
    expect(parseCostAlert("OFF")).toEqual({ type: "off" })
    expect(parseCostAlert("Disable")).toEqual({ type: "off" })
    expect(parseCostAlert("CLEAR")).toEqual({ type: "off" })
  })

  test("rejects invalid values", () => {
    expect(parseCostAlert("nope")).toEqual({ type: "invalid" })
    expect(parseCostAlert("$")).toEqual({ type: "invalid" })
    expect(parseCostAlert("-1")).toEqual({ type: "invalid" })
    expect(parseCostAlert("1 2")).toEqual({ type: "invalid" })
  })

  test("rejects non-decimal numeric forms", () => {
    expect(parseCostAlert("1e3")).toEqual({ type: "invalid" })
    expect(parseCostAlert("0x10")).toEqual({ type: "invalid" })
    expect(parseCostAlert("0b10")).toEqual({ type: "invalid" })
    expect(parseCostAlert("Infinity")).toEqual({ type: "invalid" })
  })
})
