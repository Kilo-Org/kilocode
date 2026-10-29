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

  test("returns undefined for a leaf the owning scope shadows", () => {
    const project = { agents: { build: { description: "d" } } }
    const global = { agents: { build: { model: "m" } } }
    expect(scopeOf(["agents", "build", "model"], project, global)).toBeUndefined()
  })

  test("resolves the owner per root when the v2 root and an alias root differ", () => {
    const project = { agents: { build: { description: "d" } } }
    const global = { small_model: "anthropic/claude" }
    expect(scopeOf(["agents", "title", "model"], project, global)).toBe("global")
  })

  test("keeps the v2 path owner when it defines the leaf", () => {
    const project = { agents: { title: { model: "anthropic/claude" } } }
    const global = { small_model: "openai/gpt" }
    expect(scopeOf(["agents", "title", "model"], project, global)).toBe("project")
  })
})
