import { describe, expect, test } from "bun:test"
import { legacyPath, writeScope } from "../webview-ui/src/components/settings/settings-scope"

describe("legacyPath", () => {
  test("maps the paths this tab writes to their legacy key", () => {
    expect(legacyPath(["snapshots"])).toEqual(["snapshot"])
    expect(legacyPath(["compaction", "keep", "tokens"])).toEqual(["compaction", "preserve_recent_tokens"])
    expect(legacyPath(["compaction", "buffer"])).toEqual(["compaction", "reserved"])
  })

  test("returns undefined for a path without a legacy key", () => {
    expect(legacyPath(["compaction", "auto"])).toBeUndefined()
    expect(legacyPath(["watcher", "ignore"])).toBeUndefined()
    expect(legacyPath(["snapshots", "extra"])).toBeUndefined()
  })
})

describe("writeScope", () => {
  test("prefers the project document that defines the key", () => {
    const source = (path: string[]) => (path.join(".") === "snapshots" ? "project" : undefined)
    expect(writeScope(source, ["snapshots"])).toBe("project")
  })

  test("prefers a project value that only exists under the legacy spelling", () => {
    const source = (path: string[]) => {
      if (path.join(".") === "snapshot") return "project"
      if (path.join(".") === "snapshots") return "global"
      return undefined
    }
    expect(writeScope(source, ["snapshots"])).toBe("project")
  })

  test("keeps the existing scope, then falls back to global", () => {
    const global = (path: string[]) => (path.join(".") === "compaction.buffer" ? "global" : undefined)
    expect(writeScope(global, ["compaction", "buffer"])).toBe("global")
    expect(writeScope(() => undefined, ["compaction", "auto"])).toBe("global")
  })
})
