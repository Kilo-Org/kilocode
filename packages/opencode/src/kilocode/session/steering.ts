import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { SessionID } from "@/session/schema"
import { BoardEnabled } from "@/kilocode/board/enabled"
import { BoardStore } from "@/kilocode/board/store"

/**
 * Metadata kind a client puts on the text part a human typed into a subagent
 * view. Only marked parts count as steering: the task tool's own prompts to a
 * child session are also non-synthetic text, so `parentID` alone is not proof
 * that a human steered the child.
 */
export const KIND = "subagent_steer"

const PREFIX = "The user steered this subagent directly:\n\n"
// Budget for the JSON-escaped body. The formatted board message adds id,
// timestamp, route, and type (~200 bytes) and must stay under 4 KiB.
const BUDGET = 3584

type Part = { type: string; text?: string; synthetic?: boolean; metadata?: Record<string, unknown> }

export function text(parts: ReadonlyArray<Part>) {
  return parts
    .flatMap((part) =>
      part.type === "text" && !part.synthetic && part.metadata?.kind === KIND && part.text ? [part.text] : [],
    )
    .join("\n")
    .trim()
}

/** Excerpt the body so its JSON-escaped form fits the board message budget. */
export function body(value: string) {
  const fit = (bytes: number): string => {
    const out = BoardStore.excerpt(PREFIX + value, bytes)
    const size = Buffer.byteLength(JSON.stringify(out))
    if (size <= BUDGET || bytes <= 1) return out
    return fit(Math.max(1, Math.min(bytes - 1, Math.floor((bytes * BUDGET) / size))))
  }
  return fit(BUDGET)
}

/**
 * Post a shared-board message from a steered subagent to its parent so the
 * parent learns that a human redirected its child. Failures are logged and
 * never fail prompt admission.
 */
export const notify = Effect.fn("KiloSessionSteering.notify")(function* (input: {
  session: { id: SessionID; parentID?: SessionID }
  parts: ReadonlyArray<Part>
  messageID: string
  config: Config.Interface
  flags: RuntimeFlags.Info
  database: Database.Interface
}) {
  const parent = input.session.parentID
  if (!parent) return
  const steer = text(input.parts)
  if (!steer) return
  if (!BoardEnabled.on(yield* input.config.get(), input.flags)) return
  yield* BoardStore.post({
    sessionID: input.session.id,
    messageID: input.messageID,
    to: parent,
    type: "INFO",
    body: body(steer),
  }).pipe(
    Effect.provideService(Database.Service, input.database),
    Effect.catch((err) =>
      Effect.logWarning("subagent steering notification failed", { "session.id": input.session.id, err }),
    ),
  )
})

export * as KiloSessionSteering from "./steering"
