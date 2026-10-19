import { Effect } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { Config } from "@/config/config"
import type { KiloSession } from "@/kilocode/session"
import type { MessageV2 } from "@/session/message-v2"
import type { MessageID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"

// Compaction events: PreCompact (asked by each caller before creating a compaction, with
// auto-compaction vetoes remembered per user message) and PostCompact.

/**
 * PreCompact before a compaction request. Returns false when a hook blocked it (manual requests
 * are told why). `hooks` comes from a tool context, so nothing resolves sandbox state inside it.
 */
export function allow(_input: {
  sessionID: SessionID
  /** User message of the turn, which an auto-compaction veto is remembered for. */
  user?: MessageID
  trigger: "manual" | "auto"
  /** Kilo-specific trigger sent as `kilo_trigger` (the `context` tool). */
  kilo?: "tool"
  overflow?: boolean
  /** A user-initiated request: a block is shown to the user. */
  manual?: boolean
  hooks?: unknown
  config?: Config.Interface
  database?: Database.Interface
  events?: EventV2.Interface
}): Effect.Effect<boolean> {
  return Effect.succeed(true)
}

/** Ends a turn whose overflow recovery a PreCompact hook blocked, as a context overflow error. */
export function overflow(_input: {
  sessionID: SessionID
  message: MessageV2.Assistant
  closeReasons: Map<string, KiloSession.CloseReason>
  sessions: Session.Interface
  events: EventV2.Interface
}): Effect.Effect<"break"> {
  return Effect.succeed("break" as const)
}

/** PostCompact after a compaction succeeded (detached); the next model step runs SessionStart `compact`. */
export function compacted(_input: {
  sessionID: SessionID
  auto: boolean
  summary: string
  config: Config.Interface
  database: Database.Interface
}): Effect.Effect<void> {
  return Effect.void
}

export * as KiloHookCompact from "./compact"
