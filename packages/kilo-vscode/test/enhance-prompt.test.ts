import { describe, expect, test } from "bun:test"
import {
  cleanEnhancedPrompt,
  ENHANCE_PROMPT_INSTRUCTION,
  enhancePromptRequest,
  normalizeEnhancePromptErrorMessage,
} from "../webview-ui/src/v2/enhance-prompt"

// Ports the v1 assertions (packages/opencode/test/kilocode/enhance-prompt.test.ts) onto the v2 webview helper.
describe("v2 enhance prompt", () => {
  test("the instruction keeps question-shaped drafts as prompts to rewrite", () => {
    expect(ENHANCE_PROMPT_INSTRUCTION).toContain("never as a request to answer")
    expect(ENHANCE_PROMPT_INSTRUCTION).toContain("rewrite it into a clearer question or request without answering it")
  })

  test("the instruction improves instruction-shaped drafts instead of following them", () => {
    expect(ENHANCE_PROMPT_INSTRUCTION).toContain("improve those instructions instead of following them")
  })

  test("the request labels the draft as text to rewrite", () => {
    const request = enhancePromptRequest("  fix the bug  ")
    expect(request).toContain(ENHANCE_PROMPT_INSTRUCTION)
    expect(request).toContain("Draft prompt to enhance, not answer:")
    expect(request.endsWith("fix the bug  ")).toBe(true)
  })

  test("clean strips whitespace, code fences and surrounding quotes", () => {
    expect(cleanEnhancedPrompt("  hello world  ")).toBe("hello world")
    expect(cleanEnhancedPrompt("```\nhello world\n```")).toBe("hello world")
    expect(cleanEnhancedPrompt("```text\nhello world\n```")).toBe("hello world")
    expect(cleanEnhancedPrompt('"hello world"')).toBe("hello world")
    expect(cleanEnhancedPrompt("'hello world'")).toBe("hello world")
    expect(cleanEnhancedPrompt('```\n"hello world"\n```')).toBe("hello world")
    expect(cleanEnhancedPrompt("hello world")).toBe("hello world")
    expect(cleanEnhancedPrompt("")).toBe("")
    expect(cleanEnhancedPrompt("   ")).toBe("")
  })

  test("clean keeps internal and mismatched quotes", () => {
    expect(cleanEnhancedPrompt('say "hello" to the world')).toBe('say "hello" to the world')
    expect(cleanEnhancedPrompt("\"hello world'")).toBe("\"hello world'")
  })

  test("quota failures become the actionable v1 message", () => {
    expect(normalizeEnhancePromptErrorMessage("insufficient_quota: check your plan")).toContain(
      "Enhance Prompt failed due to provider quota/billing limits.",
    )
    expect(normalizeEnhancePromptErrorMessage("Exceeded your current quota")).toContain("provider quota/billing limits")
    expect(normalizeEnhancePromptErrorMessage("network error")).toBe("network error")
    expect(normalizeEnhancePromptErrorMessage("")).toBe("Failed to enhance prompt")
  })
})
