
import { Effect } from "effect"
import { KiloSessionPrompt } from "@/kilocode/session/prompt" // kilocode_change
import { Agent } from "@/agent/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { PartID } from "./schema"
import { Session } from "./session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import CODE_SWITCH from "./prompt/code-switch.txt" // kilocode_change

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  // kilocode_change start - shared planning / agent-switch reminder path
  yield* Effect.promise(() =>
    KiloSessionPrompt.insertPlanReminders({
      agent: input.agent,
      session: input.session,
      userMessage,
      messages: input.messages,
    }),
  )
  const switched = KiloSessionPrompt.insertAgentSwitchReminder({
    agent: input.agent,
    userMessage,
    messages: input.messages,
  })
  if (switched) userMessage.parts.push(yield* sessions.updatePart(switched))
  // kilocode_change end

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  const wasPlanning = assistantMessage?.info.agent === "plan" || assistantMessage?.info.agent === "architect"
  if (input.agent.name === "code" && wasPlanning) {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `\n\n${CODE_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it` // kilocode_change - renamed from BUILD_SWITCH to CODE_SWITCH
        : `\n\n${CODE_SWITCH}`, // kilocode_change - renamed from BUILD_SWITCH to CODE_SWITCH
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  // kilocode_change start - replace native Plan's separate prompt with the shared reminder above
  return input.messages
  // kilocode_change end
})

export * as SessionReminders from "./reminders"
