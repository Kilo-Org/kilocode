import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { PartID } from "@/session/schema"
import { Session } from "@/session/session"
import AGENT_SWITCH from "./agent-switch.txt"
import { KiloSessionPrompt } from "./prompt"

/**
 * Single policy for the mode reminders sent to the model.
 *
 * Every Plan turn re-injects its planning instructions (transient). Every
 * agent change adds one persisted switch reminder that names both agents, so
 * the newest reminder always supersedes older ones, for built-in, custom, and
 * organization agents alike. The capability line is derived from the
 * permission ruleset for native agents only; their rulesets are known and a
 * catch-all edit rule describes them accurately. Custom and organization
 * agents get a neutral line, because scoped allowlists (for example
 * `docs/**`) cannot be summarised safely from a catch-all check.
 */
export namespace KiloModeReminders {
  export type Target = Pick<Agent.Info, "name" | "displayName" | "permission" | "native">

  export const READONLY =
    "This agent cannot modify files or run mutating commands. If a request needs implementation, suggest switching to an agent that can."
  export const WRITABLE = "This agent may modify files and run commands within its configured permissions."
  export const NEUTRAL =
    "Use the tools according to this agent's configured permissions; the permission system reports what is allowed."

  export function writable(agent: Target) {
    return Permission.evaluate("edit", "*", agent.permission).action !== "deny"
  }

  export function capability(agent: Target) {
    if (agent.native !== true) return NEUTRAL
    return writable(agent) ? WRITABLE : READONLY
  }

  /** Switch reminder text for the current turn, or undefined when the agent did not change. */
  export function transition(input: { current: Target; prior?: string }) {
    const prior = input.prior?.trim()
    if (!prior || prior.toLowerCase() === input.current.name.toLowerCase()) return
    const text = AGENT_SWITCH.replaceAll("${prior}", () => prior)
      .replaceAll("${current}", () => input.current.displayName ?? input.current.name)
      .replaceAll("${capability}", () => capability(input.current))
    return `\n\n${text}`
  }

  export const apply = Effect.fn("KiloModeReminders.apply")(function* (input: {
    messages: SessionV1.WithParts[]
    agent: Agent.Info
    session: Session.Info
  }) {
    const sessions = yield* Session.Service
    const user = input.messages.findLast((msg) => msg.info.role === "user")
    if (!user) return input.messages

    yield* Effect.promise(() =>
      KiloSessionPrompt.insertPlanReminders({
        agent: input.agent,
        session: input.session,
        userMessage: user,
        messages: input.messages,
      }),
    )

    const prior = input.messages.findLast((msg) => msg.info.id !== user.info.id)
    const text = transition({ current: input.agent, prior: prior?.info.agent })
    if (!text) return input.messages
    if (user.parts.some((part) => part.type === "text" && part.text === text)) return input.messages

    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: user.info.id,
      sessionID: user.info.sessionID,
      type: "text",
      text,
      synthetic: true,
    })
    user.parts.push(part)
    return input.messages
  })
}
