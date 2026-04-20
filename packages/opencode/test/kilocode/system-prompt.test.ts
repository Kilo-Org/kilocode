import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import { ProviderTest } from "../fake/provider"

import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_CODEX from "../../src/session/prompt/codex.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"
import PROMPT_TRINITY from "../../src/session/prompt/trinity.txt"

describe("SystemPrompt.provider", () => {
  describe("model.prompt override", () => {
    test("anthropic prompt is selected when model.prompt is 'anthropic'", () => {
      const model = ProviderTest.model({ prompt: "anthropic" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_ANTHROPIC])
    })

    test("default prompt is selected when model.prompt is 'anthropic_without_todo'", () => {
      const model = ProviderTest.model({ prompt: "anthropic_without_todo" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_DEFAULT])
    })

    test("beast prompt is selected when model.prompt is 'beast'", () => {
      const model = ProviderTest.model({ prompt: "beast" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_BEAST])
    })

    test("codex prompt is selected when model.prompt is 'codex'", () => {
      const model = ProviderTest.model({ prompt: "codex" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })

    test("gemini prompt is selected when model.prompt is 'gemini'", () => {
      const model = ProviderTest.model({ prompt: "gemini" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GEMINI])
    })

    test("trinity prompt is selected when model.prompt is 'trinity'", () => {
      const model = ProviderTest.model({ prompt: "trinity" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_TRINITY])
    })

    test("model.prompt takes precedence over model.api.id heuristic", () => {
      // A model whose api.id contains "claude" (which would match anthropic via heuristic)
      // but has prompt set to "beast" — prompt should win
      const model = ProviderTest.model({
        prompt: "beast",
        api: { id: "anthropic/claude-4-opus", url: "https://example.com", npm: "@ai-sdk/anthropic" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_BEAST])
    })

    test("model.api.id heuristic is used when model.prompt is undefined", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "anthropic/claude-4-opus", url: "https://example.com", npm: "@ai-sdk/anthropic" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_ANTHROPIC])
    })
  })
})
