import { Effect } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { Config } from "@/config/config"
import type { SessionProcessor } from "@/session/processor"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import type { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"

// Agent loop events: Stop, SubagentStop, SubagentStart, PostToolBatch, and the per-session halt
// that tool hooks set with `continue: false`.

/**
 * Stop / SubagentStop at the natural end of a turn. Returns true when a hook made the turn
 * continue (a continuation user message was persisted), within the loop caps.
 */
export function stop(_input: {
  sessionID: SessionID
  session: Session.Info
  step: number
  user: MessageV2.User
  assistant?: MessageV2.WithParts
  msgs: MessageV2.WithParts[]
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}): Effect.Effect<boolean> {
  return Effect.succeed(false)
}

/**
 * PostToolBatch after a model step that ran tools, and the halt a tool hook's `continue: false`
 * requested. Returns true when the turn must end.
 */
export function batch(_input: {
  sessionID: SessionID
  message: MessageV2.Assistant
  result: SessionProcessor.Result
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}): Effect.Effect<boolean> {
  return Effect.succeed(false)
}

/** SubagentStart when the task tool spawns or resumes a subagent: parts for the child's first prompt. */
export function subagent(_input: {
  parent: SessionID
  child: Session.Info
  agent: string
  resumed: boolean
  signal?: AbortSignal
  /** The parent's resolved hooks (`ctx.extra.hooks`). */
  hooks?: unknown
  config: Config.Interface
  database: Database.Interface
}): Effect.Effect<SessionPrompt.PromptInput["parts"]> {
  return Effect.succeed([])
}

/** Records that a tool hook stopped the turn (`continue: false`); the PostToolBatch site ends it. */
export function halt(_sessionID: string, _reason: string): void {}

/** Reads and clears the reason a hook stopped the session's last turn, for the goal runner. */
export function stopped(_sessionID: string): string | undefined {
  return undefined
}

export * as KiloHookLoop from "./loop"
