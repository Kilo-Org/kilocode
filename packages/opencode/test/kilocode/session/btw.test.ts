import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloBtw } from "../../../src/kilocode/session/btw"
import { clearPromptCacheKey, resolvePromptCacheKey, setPromptCacheKey } from "../../../src/kilocode/session/cache-key"
import { BTW_FORK } from "../../../src/kilocode/session/fork-marker"
import { KiloSessionPrompt } from "../../../src/kilocode/session/prompt"
import { Permission } from "../../../src/permission"
import * as ProviderTransform from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

describe("prompt cache key override", () => {
  test("resolves to session id by default", () => {
    expect(resolvePromptCacheKey("ses_parent")).toBe("ses_parent")
  })

  test("btw fork reuses the parent key until cleared", () => {
    setPromptCacheKey("ses_fork", "ses_parent")
    expect(resolvePromptCacheKey("ses_fork")).toBe("ses_parent")
    clearPromptCacheKey("ses_fork")
    expect(resolvePromptCacheKey("ses_fork")).toBe("ses_fork")
  })

  test("ProviderTransform uses the overridden promptCacheKey for openai", () => {
    setPromptCacheKey("ses_fork", "ses_parent")
    const model = {
      api: { npm: "@ai-sdk/openai", id: "gpt-4o" },
      providerID: "openai",
      id: "gpt-4o",
      cost: {},
    } as unknown as Provider.Model
    const opts = ProviderTransform.options({ model, sessionID: "ses_fork", providerOptions: {} })
    expect(opts.promptCacheKey).toBe("ses_parent")
    clearPromptCacheKey("ses_fork")
    const restored = ProviderTransform.options({ model, sessionID: "ses_fork", providerOptions: {} })
    expect(restored.promptCacheKey).toBe("ses_fork")
  })

  test("ProviderTransform uses the overridden prompt_cache_key for deepinfra", () => {
    setPromptCacheKey("ses_fork", "ses_parent")
    const model = {
      api: { npm: "@ai-sdk/deepinfra", id: "deepseek-v3" },
      providerID: "deepinfra",
      id: "deepseek-v3",
      cost: {},
    } as unknown as Provider.Model
    const opts = ProviderTransform.options({ model, sessionID: "ses_fork", providerOptions: {} })
    expect(opts.prompt_cache_key).toBe("ses_parent")
    clearPromptCacheKey("ses_fork")
  })
})

describe("KiloBtw fork permissions", () => {
  const last = (rules: ReturnType<typeof KiloBtw.forkPermission>, permission: string, pattern = "*") =>
    [...rules].reverse().find((rule) => rule.permission === permission && rule.pattern === pattern)

  test("allows read tools when the parent has no restrictions", () => {
    const rules = KiloBtw.forkPermission([], [])
    expect(last(rules, "read")?.action).toBe("allow")
    // Non-allowlist tools (MCP servers, shell, edits) are only matched by
    // the deny-all rule.
    expect(rules.find((rule) => rule.permission === "*")?.action).toBe("deny")
    expect(rules.filter((rule) => rule.permission === "bash").length).toBe(0)
    expect(rules.filter((rule) => rule.permission === "edit").length).toBe(0)
  })

  test("keeps parent read denies instead of granting access", () => {
    const rules = KiloBtw.forkPermission([{ permission: "read", action: "deny", pattern: "*" }], [])
    expect(last(rules, "read")?.action).toBe("deny")
    expect(rules.filter((rule) => rule.permission === "read").every((rule) => rule.action === "deny")).toBe(true)
  })

  test("downgrades parent read ask rules to deny (fork cannot prompt)", () => {
    const rules = KiloBtw.forkPermission(
      [
        { permission: "read", action: "allow", pattern: "*" },
        { permission: "read", action: "ask", pattern: "*.env" },
      ],
      [],
    )
    expect(last(rules, "read", "*")?.action).toBe("allow")
    expect(last(rules, "read", "*.env")?.action).toBe("deny")
    expect(rules.some((rule) => rule.action === "ask")).toBe(false)
  })

  test("replaces parent wildcard allows with the deny baseline", () => {
    const rules = KiloBtw.forkPermission([{ permission: "*", action: "allow", pattern: "*" }], [])
    expect(last(rules, "*")?.action).toBe("deny")
    expect(rules.filter((rule) => rule.permission === "*").every((rule) => rule.action === "deny")).toBe(true)
  })

  test("locked-down parent (wildcard deny) suppresses blanket allows", () => {
    const rules = KiloBtw.forkPermission([{ permission: "*", action: "deny", pattern: "*" }], [])
    expect(rules.find((rule) => rule.permission === "read")).toBeUndefined()
    expect(rules.every((rule) => rule.action === "deny")).toBe(true)
  })

  test("honours agent-level read denies for *.env", () => {
    const agent = Permission.fromConfig({ "*": "allow", read: { "*": "allow", "*.env": "deny" } })
    const rules = KiloBtw.forkPermission(agent, [])
    expect(Permission.evaluate("read", ".env", rules).action).toBe("deny")
    expect(Permission.evaluate("read", "src/index.ts", rules).action).toBe("allow")
    expect(Permission.evaluate("bash", "ls", rules).action).toBe("deny")
    expect(rules.some((rule) => rule.action === "ask")).toBe(false)
  })
})

describe("btw fork permission assembly", () => {
  test("treats the fork ruleset as complete for guarded agents", () => {
    const rules = Permission.fromConfig({ "*": "deny", read: "allow" })
    const agent = {
      name: "plan",
      permission: Permission.fromConfig({ edit: "deny", read: { "*": "allow", "*.env": "ask" } }),
    }

    // A guarded agent normally has session rules merged with agent rules, which
    // would replay the allowlist's "*" deny last and disable every tool.
    const gated = KiloSessionPrompt.guardPermissions({ agent, session: { permission: rules } })
    expect(gated).not.toEqual(rules)

    // Marked forks pass their ruleset through untouched.
    const forked = KiloSessionPrompt.guardPermissions({
      agent,
      session: { permission: rules, metadata: { [BTW_FORK]: true } },
    })
    expect(forked).toEqual(rules)
  })
})

describe("KiloBtw store", () => {
  test("add/list roundtrip with newest first and cap", async () => {
    const parent = "ses_store"
    for (let i = 0; i < KiloBtw.MAX_ENTRIES + 3; i++) {
      await Effect.runPromise(KiloBtw.add({ parentID: parent, question: `q${i}`, answer: `a${i}` }))
    }
    const entries = await Effect.runPromise(KiloBtw.list(parent))
    expect(entries.length).toBe(KiloBtw.MAX_ENTRIES)
    expect(entries[0].question).toBe(`q${KiloBtw.MAX_ENTRIES + 2}`)
  })

  test("trims long question and answer", async () => {
    const parent = "ses_trim"
    const long = "x".repeat(KiloBtw.MAX_ANSWER_CHARS + 100)
    const entry = await Effect.runPromise(
      KiloBtw.add({ parentID: parent, question: long, answer: long, model: { providerID: "p", modelID: "m" } }),
    )
    expect(entry.question.length).toBe(KiloBtw.MAX_QUESTION_CHARS + "\n…[truncated]".length)
    expect(entry.answer.length).toBe(KiloBtw.MAX_ANSWER_CHARS + "\n…[truncated]".length)
    expect(entry.model?.modelID).toBe("m")
  })

  test("formatting", () => {
    expect(KiloBtw.formatUsage()).toContain("/btw")
    const text = KiloBtw.formatEntry({
      id: "btw_1",
      parentID: "ses_1",
      question: "what is foo?",
      answer: "foo is bar",
      created: 0,
      model: { providerID: "openai", modelID: "gpt-4o" },
    })
    expect(text).toContain("what is foo?")
    expect(text).toContain("foo is bar")
    expect(text).toContain("openai/gpt-4o")
  })
})
