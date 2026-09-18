import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { KiloModeReminders } from "@/kilocode/session/mode-reminders" // kilocode_change
import { Session } from "./session"

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  // kilocode_change start - mode reminder policy (plan, ask, code switches) lives in kilocode/session/mode-reminders.ts
  return yield* KiloModeReminders.apply(input)
  // kilocode_change end
})

export * as SessionReminders from "./reminders"
