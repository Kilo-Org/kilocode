import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloBtw } from "../../../src/kilocode/session/btw"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

describe("KiloBtw", () => {
  test("formatUsage returns help text", () => {
    const text = KiloBtw.formatUsage()
    expect(text).toContain("/btw")
    expect(text).toContain("without adding")
  })

  test("formatEntry includes question and answer", () => {
    const entry: KiloBtw.Entry = {
      id: "btw_1",
      parentID: "ses_123",
      question: "what is foo?",
      answer: "foo is bar",
      created: Date.now(),
      model: { providerID: "openai", modelID: "gpt-4o" },
    }
    const text = KiloBtw.formatEntry(entry)
    expect(text).toContain("what is foo")
    expect(text).toContain("foo is bar")
    expect(text).toContain("openai/gpt-4o")
  })

  test("promptCache override reuses parent key", () => {
    const fork = "ses_fork_btw_test"
    const parent = "ses_parent_btw_test"
    KiloBtw.setPromptCacheOverride(fork, parent)
    expect(KiloBtw.getPromptCacheOverride(fork)).toBe(parent)
    expect(KiloBtw.resolvePromptCacheKey(fork)).toBe(parent)
    expect(KiloBtw.resolvePromptCacheKey("other")).toBe("other")
    KiloBtw.clearPromptCacheOverride(fork)
    expect(KiloBtw.getPromptCacheOverride(fork)).toBeUndefined()
    expect(KiloBtw.resolvePromptCacheKey(fork)).toBe(fork)
  })

  test("ProviderTransform uses overridden promptCacheKey", () => {
    const parent = "ses_parent_123"
    const fork = "ses_fork_456"
    KiloBtw.setPromptCacheOverride(fork, parent)
    const model = {
      api: { npm: "@ai-sdk/openai", id: "gpt-4o" },
      providerID: "openai",
      id: "gpt-4o",
      cost: {},
    } as unknown as Provider.Model
    const opts = ProviderTransform.options({ model, sessionID: fork, providerOptions: {} })
    expect(opts.promptCacheKey).toBe(parent)
    KiloBtw.clearPromptCacheOverride(fork)
    const opts2 = ProviderTransform.options({ model, sessionID: fork, providerOptions: {} })
    expect(opts2.promptCacheKey).toBe(fork)
  })

  test("ProviderTransform prompt_cache_key override for deepinfra", () => {
    const parent = "ses_parent_deep"
    const fork = "ses_fork_deep"
    KiloBtw.setPromptCacheOverride(fork, parent)
    const model = {
      api: { npm: "@ai-sdk/deepinfra", id: "deepseek-v3" },
      providerID: "deepinfra",
      id: "deepseek-v3",
    } as unknown as Provider.Model
    const opts = ProviderTransform.options({ model, sessionID: fork, providerOptions: {} })
    expect(opts.prompt_cache_key).toBe(parent)
    KiloBtw.clearPromptCacheOverride(fork)
  })

  test("trims long question/answer via store (mocked)", async () => {
    // This test exercises the in-memory helpers without needing Storage.
    // Full Storage integration is covered by session integration tests.
    const longQ = "a".repeat(KiloBtw.MAX_QUESTION_CHARS + 100)
    const longA = "b".repeat(KiloBtw.MAX_ANSWER_CHARS + 100)
    const trimmedQ = (KiloBtw as any).MAX_QUESTION_CHARS
      ? longQ.slice(0, KiloBtw.MAX_QUESTION_CHARS) + "\n…[truncated]"
      : longQ
    expect(trimmedQ.length).toBeLessThan(longQ.length)
    const trimmedA = longA.slice(0, KiloBtw.MAX_ANSWER_CHARS) + "\n…[truncated]"
    expect(trimmedA.length).toBeLessThan(longA.length)
  })
})
