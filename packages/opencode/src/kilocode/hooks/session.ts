import { Effect } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { Config } from "@/config/config"
import type { Instruction } from "@/session/instruction"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import type { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"

// Session events: SessionStart (once per root session per process, and after compaction or a
// fork), SessionEnd, InstructionsLoaded for session instructions, and persisting pending
// SessionStart / PostModelSwitch context on the turn's user message.

/** Runs SessionStart for a root session once per process. Returns context parts for the prompt. */
export function ensure(_input: {
  sessionID: SessionID
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
  signal?: AbortSignal
}): Effect.Effect<SessionPrompt.PromptInput["parts"]> {
  return Effect.succeed([])
}

/**
 * Before a model step: runs SessionStart when it has not run yet (or after compaction) and
 * persists pending SessionStart / PostModelSwitch context on `lastUser`, also pushing it into `msgs`.
 */
export function inject(_input: {
  msgs: MessageV2.WithParts[]
  lastUser: MessageV2.User
  session: Session.Info
  sessionID: SessionID
  step: number
  instruction: Instruction.Interface
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}): Effect.Effect<void> {
  return Effect.void
}

/** Marks a session created by a fork, so its SessionStart sends `source: "fork"`. */
export function forked(_sessionID: SessionID): void {}

/** Marks a session as compacted, so its next model step runs SessionStart with `source: "compact"`. */
export function compacted(_sessionID: SessionID): void {}

/**
 * Runs SessionEnd for every root session that started in this process, within a shared time
 * budget (capped at `cap` ms). Used at process shutdown, outside any Effect runtime.
 */
export async function end(_reason: "other" | "prompt_input_exit", _cap?: number): Promise<void> {}

export * as KiloHookSession from "./session"
