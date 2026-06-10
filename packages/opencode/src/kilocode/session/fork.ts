import { Effect } from "effect"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionID, PartID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.fork" })

/**
 * Extracts the child session ID from a task tool part.
 */
function childID(part: MessageV2.Part): string | undefined {
  if (part.type !== "tool" || part.tool !== "task") return undefined
  return (part.state as { metadata?: { sessionId?: string } }).metadata?.sessionId
}

/**
 * Recursively fork all child (subagent) sessions referenced by task tool parts
 * in the given session, then update the parts to point at the forked copies.
 *
 * This prevents subagent state from leaking between forked sessions in the
 * same worktree: without remapping, two forked sessions would share the same
 * child session references, causing SSE events and permission prompts to bleed
 * across sessions.
 */
export function remapChildren(
  sid: SessionID,
  remapped = new Map<string, SessionID>(),
): Effect.Effect<void, Session.NotFound, Session.Service> {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const msgs = yield* sessions.messages({ sessionID: sid })
    const refs: { part: MessageV2.ToolPart; child: string }[] = []
    for (const msg of msgs) {
      for (const part of msg.parts) {
        const child = childID(part)
        if (child) refs.push({ part: part as MessageV2.ToolPart, child })
      }
    }
    if (refs.length === 0) return

    for (const ref of refs) {
      if (remapped.has(ref.child)) continue
      const exists = yield* sessions.get(SessionID.make(ref.child)).pipe(Effect.orElseSucceed(() => undefined))
      if (!exists) continue
      const forked = yield* sessions.fork({ sessionID: SessionID.make(ref.child) })
      remapped.set(ref.child, forked.id)
      yield* remapChildren(forked.id, remapped)
    }

    if (remapped.size === 0) return

    for (const ref of refs) {
      const replacement = remapped.get(ref.child)
      if (!replacement) continue
      const meta = (ref.part.state as { metadata?: Record<string, unknown> }).metadata
      if (!meta) continue
      yield* sessions.updatePart({
        ...ref.part,
        id: PartID.make(ref.part.id),
        sessionID: SessionID.make(ref.part.sessionID),
        state: {
          ...ref.part.state,
          metadata: { ...meta, sessionId: replacement },
        },
      } as MessageV2.ToolPart)
    }

    log.info("remapped child sessions", { session: sid, count: remapped.size })
  })
}
