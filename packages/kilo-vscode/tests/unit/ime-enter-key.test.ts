import { describe, it, expect } from "bun:test"
import { isEnterKeyCommitNotIme } from "../../webview-ui/src/utils/ime-enter"

describe("isEnterKeyCommitNotIme", () => {
  it("is true for a normal Enter keydown", () => {
    expect(isEnterKeyCommitNotIme({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true)
  })

  it("is false while isComposing is true", () => {
    expect(isEnterKeyCommitNotIme({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(false)
  })

  it("is false when keyCode is 229 (IME-processed key on Windows)", () => {
    expect(isEnterKeyCommitNotIme({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(false)
  })

  it("is false for non-Enter keys", () => {
    expect(isEnterKeyCommitNotIme({ key: "a", isComposing: false, keyCode: 65 })).toBe(false)
  })
})
