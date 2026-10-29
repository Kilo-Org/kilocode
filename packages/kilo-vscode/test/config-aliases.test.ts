import { describe, expect, test } from "bun:test"
import { scopeOf } from "../src/config-aliases"

describe("scopeOf", () => {
  test("reports the project scope for a v2 path", () => {
    expect(scopeOf(["share"], { share: "auto" }, {})).toBe("project")
  })

  test("reports the global scope when only global defines the path", () => {
    expect(scopeOf(["share"], {}, { share: "auto" })).toBe("global")
  })

  test("project wins over global when both define the path", () => {
    expect(scopeOf(["share"], { share: "auto" }, { share: "disabled" })).toBe("project")
  })

  test("reports the scope that defines only a legacy alias", () => {
    expect(
      scopeOf(["compaction", "keep", "tokens"], { compaction: { preserve_recent_tokens: 1000 } }, {}),
    ).toBe("project")
    expect(scopeOf(["permissions"], {}, { tools: { bash: true } })).toBe("global")
  })

  test("returns undefined when neither file defines the path or an alias", () => {
    expect(scopeOf(["share"], {}, {})).toBeUndefined()
  })
})
