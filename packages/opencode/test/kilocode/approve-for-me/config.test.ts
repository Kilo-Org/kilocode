import { describe, expect, test } from "bun:test"
import { ApproveForMeConfig } from "@/kilocode/approve-for-me/config"

describe("ApproveForMeConfig.resolve", () => {
  test("defaults to off when unset", () => {
    expect(ApproveForMeConfig.resolve({})).toEqual({ mode: "off" })
  })

  test("returns the configured mode", () => {
    expect(ApproveForMeConfig.resolve({ approve_for_me: { mode: "review" } })).toEqual({ mode: "review" })
    expect(ApproveForMeConfig.resolve({ approve_for_me: { mode: "auto" } })).toEqual({ mode: "auto" })
  })

  test("defaults to off when mode is present but empty", () => {
    expect(ApproveForMeConfig.resolve({ approve_for_me: {} })).toEqual({ mode: "off" })
  })
})
