import { describe, expect, test } from "bun:test"
import { writeScope } from "../webview-ui/src/components/settings/settings-scope"

describe("writeScope", () => {
  test("prefers the project document that defines the key", () => {
    const source = (path: string[]) => (path.join(".") === "snapshots" ? "project" : undefined)
    expect(writeScope(source, ["snapshots"])).toBe("project")
  })

  test("writes to the project when its section shadows the leaf", () => {
    const source = (path: string[]) => {
      if (path.join(".") === "compaction.auto") return "project"
      if (path.join(".") === "compaction") return "project"
      if (path.join(".") === "compaction.keep.tokens") return "global"
      return undefined
    }
    expect(writeScope(source, ["compaction", "keep", "tokens"])).toBe("project")
  })

  test("keeps the existing scope, then falls back to global", () => {
    const global = (path: string[]) => (path.join(".") === "compaction.buffer" ? "global" : undefined)
    expect(writeScope(global, ["compaction", "buffer"])).toBe("global")
    expect(writeScope(() => undefined, ["compaction", "auto"])).toBe("global")
  })
})
