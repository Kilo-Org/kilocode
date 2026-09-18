import { describe, expect, it } from "bun:test"
import { taskBackground } from "../../webview-ui/src/components/chat/task-tool-state"

describe("taskBackground", () => {
  it("reads the background flag from the streamed input", () => {
    expect(taskBackground({ background: true }, undefined, undefined)).toBe(true)
  })

  it("reads the background flag from part or state metadata", () => {
    expect(taskBackground({}, { background: true }, undefined)).toBe(true)
    expect(taskBackground(undefined, undefined, { background: true })).toBe(true)
  })

  it("prefers part metadata over state metadata", () => {
    expect(taskBackground({}, { background: false }, { background: true })).toBe(false)
    expect(taskBackground({}, { background: true }, { background: false })).toBe(true)
  })

  it("is false without an explicit true flag", () => {
    expect(taskBackground({}, {}, {})).toBe(false)
    expect(taskBackground(undefined, undefined, undefined)).toBe(false)
    expect(taskBackground({ background: "yes" }, {}, {})).toBe(false)
  })
})
