import { describe, it, expect } from "bun:test"
import { normalizeEnhancePromptErrorMessage } from "../../src/enhance-prompt-error"

describe("normalizeEnhancePromptErrorMessage", () => {
  it("returns guidance for exceeded current quota errors", () => {
    const msg = normalizeEnhancePromptErrorMessage(
      "AI_RetryError: Failed after 4 attempts. Last error: You exceeded your current quota, please check your plan and billing details.",
    )

    expect(msg).toContain("provider quota/billing limits")
    expect(msg).toContain("Check your provider account billing/quota and API access, then retry.")
    expect(msg).toContain("Provider response:")
  })

  it("returns guidance for insufficient_quota style errors", () => {
    const msg = normalizeEnhancePromptErrorMessage("OpenAI API error: insufficient_quota")

    expect(msg).toContain("provider quota/billing limits")
    expect(msg).toContain("Provider response: OpenAI API error: insufficient_quota")
  })

  it("returns original error for non-quota failures", () => {
    const raw = "Request timed out while connecting to provider"
    expect(normalizeEnhancePromptErrorMessage(raw)).toBe(raw)
  })
})
