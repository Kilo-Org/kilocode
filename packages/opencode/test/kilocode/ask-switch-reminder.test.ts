import { describe, expect, test } from "bun:test"
import ASK_CODE_SWITCH from "../../src/kilocode/session/ask-code-switch.txt"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "../../src/session/message-v2"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"

const model = {
  providerID: ProviderV2.ID.make("openai"),
  modelID: ModelV2.ID.make("gpt-4"),
}

function user(input: { agent: string; text: string }) {
  const id = MessageID.ascending()
  const sessionID = SessionID.make("ses_test")
  return {
    info: {
      id,
      role: "user" as const,
      sessionID,
      time: { created: Date.now() },
      agent: input.agent,
      model,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID,
        type: "text" as const,
        text: input.text,
      },
    ],
  } satisfies MessageV2.WithParts
}

function assistant(input: { sessionID: SessionID; parentID: MessageID; agent: string; text: string }) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant" as const,
      sessionID: input.sessionID,
      time: { created: Date.now() },
      parentID: input.parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      mode: input.agent,
      agent: input.agent,
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text" as const,
        text: input.text,
      },
    ],
  } satisfies MessageV2.WithParts
}

function reminder(message: MessageV2.WithParts) {
  return message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .find((text) => text === ASK_CODE_SWITCH)
}

describe("insertAgentSwitchReminder", () => {
  test("injects Ask to Code reminder when the previous turn was Ask", () => {
    const ask = user({ agent: "ask", text: "How does this work?" })
    const reply = assistant({
      sessionID: ask.info.sessionID,
      parentID: ask.info.id,
      agent: "ask",
      text: "I cannot modify files in Ask mode.",
    })
    const next = user({ agent: "code", text: "Please implement the change." })
    next.info.sessionID = ask.info.sessionID
    for (const part of next.parts) part.sessionID = ask.info.sessionID

    const added = KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: next,
      messages: [ask, reply, next],
    })

    expect(added?.text).toBe(ASK_CODE_SWITCH)
    expect(reminder(next)).toBeUndefined()
    next.parts.push(added!)
    expect(reminder(next)).toBe(ASK_CODE_SWITCH)
    expect(ASK_CODE_SWITCH).toContain("from Ask to Code")
    expect(ASK_CODE_SWITCH).toContain("permissions configured for this agent")
    expect(ASK_CODE_SWITCH).not.toContain("full toolset")
    expect(ASK_CODE_SWITCH).not.toContain("You may modify files")
  })

  test("does not inject after an intermediate non-Ask agent", () => {
    const ask = user({ agent: "ask", text: "How does this work?" })
    const asked = assistant({
      sessionID: ask.info.sessionID,
      parentID: ask.info.id,
      agent: "ask",
      text: "I cannot modify files in Ask mode.",
    })
    const review = user({ agent: "review", text: "Review that plan." })
    review.info.sessionID = ask.info.sessionID
    const reviewed = assistant({
      sessionID: ask.info.sessionID,
      parentID: review.info.id,
      agent: "review",
      text: "Looks good.",
    })
    const next = user({ agent: "code", text: "Implement it." })
    next.info.sessionID = ask.info.sessionID

    KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: next,
      messages: [ask, asked, review, reviewed, next],
    })

    expect(reminder(next)).toBeUndefined()
  })

  test("does not inject when staying in Ask", () => {
    const ask = user({ agent: "ask", text: "Explain this." })
    const reply = assistant({
      sessionID: ask.info.sessionID,
      parentID: ask.info.id,
      agent: "ask",
      text: "Here is the explanation.",
    })
    const next = user({ agent: "ask", text: "And this file?" })
    next.info.sessionID = ask.info.sessionID

    KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "ask" },
      userMessage: next,
      messages: [ask, reply, next],
    })

    expect(reminder(next)).toBeUndefined()
  })

  test("does not inject on later Code turns after the switch", () => {
    const ask = user({ agent: "ask", text: "How does this work?" })
    const reply = assistant({
      sessionID: ask.info.sessionID,
      parentID: ask.info.id,
      agent: "ask",
      text: "I cannot modify files in Ask mode.",
    })
    const first = user({ agent: "code", text: "Implement it." })
    first.info.sessionID = ask.info.sessionID
    const coded = assistant({
      sessionID: ask.info.sessionID,
      parentID: first.info.id,
      agent: "code",
      text: "Done.",
    })
    const later = user({ agent: "code", text: "Also add tests." })
    later.info.sessionID = ask.info.sessionID

    KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: later,
      messages: [ask, reply, first, coded, later],
    })

    expect(reminder(later)).toBeUndefined()
  })

  test("does not inject twice on the same user message", () => {
    const ask = user({ agent: "ask", text: "How does this work?" })
    const reply = assistant({
      sessionID: ask.info.sessionID,
      parentID: ask.info.id,
      agent: "ask",
      text: "I cannot modify files in Ask mode.",
    })
    const next = user({ agent: "code", text: "Please implement the change." })
    next.info.sessionID = ask.info.sessionID

    const first = KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: next,
      messages: [ask, reply, next],
    })
    next.parts.push(first!)
    const second = KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: next,
      messages: [ask, reply, next],
    })

    expect(second).toBeUndefined()
    expect(next.parts.filter((part) => part.type === "text" && part.text === ASK_CODE_SWITCH)).toHaveLength(1)
  })

  test("does not inject on Plan to Code", () => {
    const plan = user({ agent: "plan", text: "Make a plan." })
    const reply = assistant({
      sessionID: plan.info.sessionID,
      parentID: plan.info.id,
      agent: "plan",
      text: "Here is the plan.",
    })
    const next = user({ agent: "code", text: "Implement the plan." })
    next.info.sessionID = plan.info.sessionID

    const added = KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "code" },
      userMessage: next,
      messages: [plan, reply, next],
    })

    expect(added).toBeUndefined()
    expect(reminder(next)).toBeUndefined()
  })

  test("does not inject when staying in Plan", () => {
    const plan = user({ agent: "plan", text: "Make a plan." })
    const reply = assistant({
      sessionID: plan.info.sessionID,
      parentID: plan.info.id,
      agent: "plan",
      text: "Here is the plan.",
    })
    const next = user({ agent: "plan", text: "Refine it." })
    next.info.sessionID = plan.info.sessionID

    const added = KiloSessionPrompt.insertAgentSwitchReminder({
      agent: { name: "plan" },
      userMessage: next,
      messages: [plan, reply, next],
    })

    expect(added).toBeUndefined()
    expect(reminder(next)).toBeUndefined()
  })
})
