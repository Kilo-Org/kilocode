import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Agent } from "../../src/agent/agent"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Session } from "../../src/session/session"
import { SessionReminders } from "../../src/session/reminders"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_reminders")
const model = { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") }

function userMsg(text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "user",
      sessionID,
      time: { created: 0 },
      agent: "build",
      model,
    },
    parts: [
      {
        id: PartID.ascending(),
        sessionID,
        messageID: id,
        type: "text",
        text,
      },
    ],
  }
}

function assistantPlan(): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      sessionID,
      time: { created: 0 },
      agent: "plan",
      modelID: model.modelID,
      providerID: model.providerID,
      parentID: "",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      mode: "",
    },
    parts: [],
  } as unknown as MessageV2.WithParts
}

const apply = (messages: MessageV2.WithParts[]) =>
  Effect.runPromise(
    SessionReminders.apply({
      messages,
      agent: { name: "code" } as unknown as Agent.Info,
      session: {} as unknown as Session.Info,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          RuntimeFlags.layer({ experimentalPlanMode: false }),
          Layer.mock(Session.Service, {}),
          FSUtil.defaultLayer,
        ),
      ),
    ),
  )

describe("SessionReminders plan-to-code switch", () => {
  test("separates the code switch reminder from user text with blank lines", async () => {
    const user = userMsg("write this to a file:")
    const messages = [assistantPlan(), user]
    const result = await apply(messages)

    expect(result).toBe(messages)
    expect(user.parts).toHaveLength(2)
    const userText = user.parts[0] as MessageV2.TextPart
    const reminder = user.parts[1] as MessageV2.TextPart
    expect(userText.text).toBe("write this to a file:")
    expect(reminder.type).toBe("text")
    expect(reminder.synthetic).toBe(true)
    expect(reminder.text.startsWith("\n\n<system-reminder>")).toBe(true)
  })
})
