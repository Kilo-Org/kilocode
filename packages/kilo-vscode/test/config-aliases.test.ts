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

  test("reports the scope that owns the key even when it shadows the other leaf", () => {
    const project = { agents: { build: { description: "d" } } }
    const global = { agents: { build: { model: "m" } } }
    expect(scopeOf(["agents", "build", "model"], project, global)).toBe("project")
  })

  test("reports the project scope when project owns the key through a v1 alias root", () => {
    const project = { tools: { write: false } }
    const global = { permissions: [{ action: "read", resource: "*", effect: "allow" }] }
    expect(scopeOf(["permissions"], project, global)).toBe("project")
  })

  test("keeps the project owner when project holds the v2 key and global the alias root", () => {
    const project = { agents: { build: { description: "d" } } }
    const global = { small_model: "anthropic/claude" }
    expect(scopeOf(["agents", "title", "model"], project, global)).toBe("project")
  })

  test("returns undefined when neither file owns the key or an alias root", () => {
    const project = { agents: { build: { description: "d" } } }
    const global = { small_model: "anthropic/claude" }
    expect(scopeOf(["compaction", "keep", "tokens"], project, global)).toBeUndefined()
  })

  test("reports the project scope when only project holds the v1 alias root", () => {
    const project = { agent: { build: { model: "anthropic/claude" } } }
    const global = { agents: { build: { model: "openai/gpt" } } }
    expect(scopeOf(["agents", "build", "model"], project, global)).toBe("project")
    expect(scopeOf(["agents", "build", "permissions"], {}, { agent: { build: { permissions: [] } } })).toBe("global")
  })

  test("places new providers in the scope that owns the providers root or its legacy alias", () => {
    expect(scopeOf(["providers"], { providers: { existing: {} } }, {})).toBe("project")
    expect(scopeOf(["providers"], { provider: { existing: {} } }, { providers: {} })).toBe("project")
    expect(scopeOf(["providers"], {}, { providers: {} })).toBe("global")
    expect(scopeOf(["providers"], {}, {})).toBeUndefined()
  })
})
