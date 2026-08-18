import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import { environmentDetails } from "../../src/kilocode/editor-context"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ProviderTest } from "../fake/provider"

import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_CODEX from "../../src/session/prompt/codex.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_GPT55 from "../../src/session/prompt/kilocode-gpt-5.5.txt"
import PROMPT_LING from "../../src/session/prompt/ling.txt"
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

    test("GPT-5.5 prompt is selected from prompt metadata", () => {
      const model = ProviderTest.model({
        prompt: "gpt55",
        api: { id: "provider-specific-model", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT55])
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

    test("Ling fallback runs after upstream model id heuristics", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5-ling", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT])
    })

    test("Ling fallback is selected after upstream heuristics miss", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "ling-2", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_LING])
    })

    test("GPT-5.5 model ids are not prompt-special without metadata", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5.5", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT])
    })

    test("codex prompt metadata still wins for GPT-5.5 model ids", () => {
      const model = ProviderTest.model({
        prompt: "codex",
        api: { id: "gpt-5.5", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })

    test("older Codex model ids keep the Codex prompt", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5.1-codex", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })
  })
})

describe("environmentDetails", () => {
  test("includes cwd and worktree in dynamic context", () => {
    const result = environmentDetails({
      directory: "/repo/.kilo/worktrees/feature",
      worktree: "/repo/.kilo/worktrees/feature",
      activeFile: "src/app.ts",
    })

    expect(result).toContain("Working directory: /repo/.kilo/worktrees/feature")
    expect(result).toContain("Workspace root folder: /repo/.kilo/worktrees/feature")
    expect(result).toContain("Active file: src/app.ts")
  })

  test("block is separated from adjacent content with leading blank lines", () => {
    const result = environmentDetails({ activeFile: "src/app.ts" })

    expect(result.startsWith("\n\n<environment_details>")).toBe(true)
    expect(result.endsWith("</environment_details>")).toBe(true)
  })
})

describe("KiloSessionPrompt.injectEditorContext", () => {
  const sessionID = SessionID.make("ses_env_sep")
  const providerID = ProviderID.make("test")

  function userInfo(id: string): MessageV2.User {
    return {
      id,
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "user",
      model: { providerID, modelID: ModelID.make("test") },
      tools: {},
      mode: "",
    } as unknown as MessageV2.User
  }

  test("appends the environment details block as its own part, separated from user text", () => {
    const messageID = "m-user"
    const msgs: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            id: PartID.make("prt_p1"),
            sessionID,
            messageID: MessageID.make("msg_m-user"),
            type: "text",
            text: "write this to a file:",
          },
        ] as MessageV2.Part[],
      },
    ]
    const lastUser = {
      ...msgs[0].info,
      editorContext: { activeFile: "src/app.ts" },
    } as unknown as MessageV2.User
    const cache: KiloSessionPrompt.EnvCache = {}

    KiloSessionPrompt.injectEditorContext({ msgs, lastUser, sessionID, cache })

    expect(msgs[0].parts).toHaveLength(2)
    const userText = msgs[0].parts[0] as MessageV2.TextPart
    const env = msgs[0].parts[1] as MessageV2.TextPart
    expect(userText.text).toBe("write this to a file:")
    expect(env.type).toBe("text")
    expect(env.synthetic).toBe(true)
    expect(env.text.startsWith("\n\n<environment_details>")).toBe(true)
    expect(env.text).toContain("Active file: src/app.ts")
  })
})
