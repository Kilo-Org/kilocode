import { describe, expect, it } from "bun:test"
import { resolveMessagePrefs } from "../../webview-ui/src/context/session-preferences"
import type { Message } from "../../webview-ui/src/types/messages"

function msg(input: Partial<Message>): Message {
  return {
    id: input.id ?? "msg",
    sessionID: input.sessionID ?? "session-a",
    role: input.role ?? "user",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...input,
  }
}

const agents = new Set(["code", "ask"])

describe("session preference recovery", () => {
  it("recovers model, variant, and agent from the latest user message", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({
          id: "old",
          agent: "ask",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "low" },
        }),
        msg({
          id: "new",
          agent: "code",
          model: { providerID: "openai", modelID: "gpt-5.5", variant: "medium" },
        }),
      ],
      agents,
    )

    expect(prefs).toEqual({
      agent: "code",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      variant: "medium",
    })
  })

  it("ignores assistant-only model data and invalid agents", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({
          role: "assistant",
          agent: "task",
          model: { providerID: "openai", modelID: "gpt-5.5", variant: "high" },
        }),
      ],
      agents,
    )

    expect(prefs).toEqual({})
  })

  it("can recover the latest valid agent separately from the latest user model", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({ agent: "ask", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } }),
        msg({ role: "assistant", agent: "code" }),
      ],
      agents,
    )

    expect(prefs).toEqual({
      agent: "code",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      variant: undefined,
    })
  })
})
