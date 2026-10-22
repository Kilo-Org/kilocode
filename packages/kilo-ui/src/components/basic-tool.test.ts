import { describe, expect, test } from "bun:test"
import { shouldRenderApprovalInBody } from "./basic-tool"

describe("shouldRenderApprovalInBody", () => {
  test("renders in the body by default when an approval exists", () => {
    expect(shouldRenderApprovalInBody(undefined, true)).toBe(true)
    expect(shouldRenderApprovalInBody("body", true)).toBe(true)
  })

  test("does not render when there is no approval", () => {
    expect(shouldRenderApprovalInBody("body", false)).toBe(false)
    expect(shouldRenderApprovalInBody(undefined, false)).toBe(false)
  })

  test("never renders in the body for hidden placement, even with an approval", () => {
    expect(shouldRenderApprovalInBody("hidden", true)).toBe(false)
    expect(shouldRenderApprovalInBody("hidden", false)).toBe(false)
  })
})
