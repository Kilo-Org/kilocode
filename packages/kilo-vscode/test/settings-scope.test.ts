import { describe, expect, test } from "bun:test"
import { writeScope } from "../webview-ui/src/v2/settings-scope"

describe("writeScope", () => {
  test("keeps an explicit scope", () => {
    expect(writeScope("global", "project")).toBe("global")
    expect(writeScope("project", "global")).toBe("project")
  })

  test("uses the owning scope when no scope is passed", () => {
    expect(writeScope(undefined, "project")).toBe("project")
    expect(writeScope(undefined, "global")).toBe("global")
  })

  test("falls back to global when no file owns the path", () => {
    expect(writeScope(undefined, undefined)).toBe("global")
  })
})
